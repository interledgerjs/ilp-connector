import { randomBytes } from 'crypto'
import { create as createLogger } from '../common/log'
const log = createLogger('route-broadcaster')
import { find } from 'lodash'
import RoutingTable from './routing-table'
import Accounts from './accounts'
import Config from './config'
import Peer from '../routing/peer'
import {
  Route,
  BroadcastRoute,
  RouteUpdateParams,
  IncomingRoute
} from '../types/routing'
import reduct = require('reduct')
import { uuid, sha256, hmac } from '../lib/utils'
import PrefixMap from '../routing/prefix-map'

interface RouteUpdate {
  epoch: number,
  prefix: string
  route?: Route
}

export default class RouteBroadcaster {
  // Local routing table, used for actually routing packets
  private localRoutingTable: RoutingTable
  // Master routing table, used for routes that we broadcast
  private masterRoutingTable: PrefixMap<Route>

  private accounts: Accounts
  private config: Config

  private peers: Map<string, Peer>
  private localRoutes: Map<string, Route>
  private routingTableId: string
  private currentEpoch: number
  private broadcastTimer?: NodeJS.Timer
  private log: RouteUpdate[]

  private routingSecret: Buffer

  constructor (deps: reduct.Injector) {
    this.localRoutingTable = deps(RoutingTable)
    this.accounts = deps(Accounts)
    this.config = deps(Config)

    if (this.config.routingSecret) {
      log.info('loaded routing secret from config.')
      this.routingSecret = Buffer.from(this.config.routingSecret, 'base64')
    } else {
      log.info('generated random routing secret.')
      this.routingSecret = randomBytes(32)
    }

    this.peers = new Map() // peerId:string -> peer:Peer
    this.localRoutes = new Map()
    this.routingTableId = uuid()
    this.masterRoutingTable = new PrefixMap()
    this.currentEpoch = 0
    this.log = []
  }

  async start () {
    try {
      for (const accountId of this.accounts.getAccountIds()) {
        this.add(accountId)
      }
      this.reloadLocalRoutes()
    } catch (e) {
      if (e.name === 'SystemError' ||
          e.name === 'ServerError') {
        // System error, in that context that is a network error
        // This will be retried later, so do nothing
      } else {
        throw e
      }
    }
  }

  stop () {
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer)
    }
  }

  add (accountId: string) {
    if (this.peers.get(accountId)) {
      // don't log duplicates
      return
    }

    const accountInfo = this.accounts.getInfo(accountId)

    let sendRoutes
    if (typeof accountInfo.sendRoutes === 'boolean') {
      sendRoutes = accountInfo.sendRoutes
    } else if (accountInfo.relation !== 'child') {
      sendRoutes = true
    } else {
      sendRoutes = false
    }

    let receiveRoutes
    if (typeof accountInfo.receiveRoutes === 'boolean') {
      receiveRoutes = accountInfo.receiveRoutes
    } else if (accountInfo.relation !== 'child') {
      receiveRoutes = true
    } else {
      receiveRoutes = false
    }

    if (sendRoutes || receiveRoutes) {
      log.debug('add peer. accountId=%s sendRoutes=%s receiveRoutes=%s', accountId, sendRoutes, receiveRoutes)
      this.peers.set(accountId, new Peer({ accountId, sendRoutes, receiveRoutes }))

      this.sendRouteUpdate(accountId)
    } else {
      log.debug('not sending/receiving routes for peer, set sendRoutes/receiveRoutes to override. accountId=%s', accountId)
    }
  }

  remove (accountId: string) {
    const peer = this.peers.get(accountId)

    if (!peer) {
      return
    }

    log.info('remove peer. peerId=' + accountId)
    this.peers.delete(accountId)

    for (let prefix of peer.getPrefixes()) {
      this.updatePrefix(prefix)
    }
    this.updatePrefix(accountId)
  }

  handleRouteUpdate (sourceAccount: string, {
    speaker,
    routingTableId,
    holdDownTime,
    fromEpoch,
    toEpoch,
    newRoutes,
    withdrawnRoutes
  }: RouteUpdateParams) {
    log.debug('received routes. sender=%s fromEpoch=%s toEpoch=%s newRoutes=%s withdrawnRoutes=%s holdDownTime=%s', sourceAccount, fromEpoch, toEpoch, newRoutes.length, withdrawnRoutes.length, holdDownTime)

    const peer = this.peers.get(sourceAccount)

    if (!peer) {
      log.info('received route update from non-peer. sourceAccount=%s', sourceAccount)
      return {
        nextRequestedEpoch: toEpoch
      }
    }

    // Apply import filters
    // TODO Route filters should be much more configurable
    newRoutes = newRoutes
      // Filter incoming routes that aren't part of the current global prefix or
      // cover the entire global prefix (i.e. the default route.)
      .filter(route =>
        route.prefix.startsWith(this.getGlobalPrefix()) &&
        route.prefix.length > this.getGlobalPrefix().length
      )

    const { changedPrefixes, nextRequestedEpoch } =
      peer.applyRouteUpdate({
        speaker,
        routingTableId,
        holdDownTime,
        fromEpoch,
        toEpoch,
        newRoutes,
        withdrawnRoutes
      })

    let haveRoutesChanged
    for (let prefix of changedPrefixes) {
      haveRoutesChanged = this.updatePrefix(prefix) || haveRoutesChanged
    }
    if (haveRoutesChanged && this.config.routeBroadcastEnabled) {
      // TODO: Should we trigger an immediate broadcast when routes change?
      //       Note that BGP does not do this AFAIK
      // this.broadcast().catch((err) => {
      //   log.warn('failed to relay route update error=%s', err.message)
      // })
    }

    return {
      nextRequestedEpoch
    }
  }

  getAccountRelation (accountId) {
    return accountId ? this.accounts.getInfo(accountId).relation : 'local'
  }

  reloadLocalRoutes () {
    log.debug('reload local and configured routes.')

    this.localRoutes = new Map()
    const localAccounts = this.accounts.getAccountIds()

    // Add a route for our own address
    const ownAddress = this.accounts.getOwnAddress()
    this.localRoutes.set(ownAddress, {
      nextHop: '',
      path: [],
      auth: hmac(this.routingSecret, ownAddress)
    })

    let defaultRoute = this.config.defaultRoute
    if (defaultRoute === 'auto') {
      defaultRoute = localAccounts.filter(id => this.accounts.getInfo(id).relation === 'parent')[0]
    }
    if (defaultRoute) {
      const globalPrefix = this.getGlobalPrefix()
      this.localRoutes.set(globalPrefix, {
        nextHop: defaultRoute,
        path: [],
        auth: hmac(this.routingSecret, globalPrefix)
      })
    }

    for (let accountId of localAccounts) {
      const info = this.accounts.getInfo(accountId)
      switch (info.relation) {
        case 'child':
          const childAddress = this.accounts.getChildAddress(accountId)
          this.localRoutes.set(childAddress, {
            nextHop: accountId,
            path: [],
            auth: hmac(this.routingSecret, childAddress)
          })
          break
      }
    }

    const localPrefixes = Array.from(this.localRoutes.keys())
    const configuredPrefixes = this.config.routes
      ? this.config.routes.map(r => r.targetPrefix)
      : []

    for (let prefix of localPrefixes.concat(configuredPrefixes)) {
      this.updatePrefix(prefix)
    }
  }

  updatePrefix (prefix: string) {
    const newBest = this.getBestPeerForPrefix(prefix)

    return this.updateLocalRoute(prefix, newBest)
  }

  getBestPeerForPrefix (prefix: string): Route | undefined {
    // configured routes have highest priority
    const configuredRoute = find(this.config.routes, { targetPrefix: prefix })
    if (configuredRoute) {
      if (this.accounts.exists(configuredRoute.peerId)) {
        return {
          nextHop: configuredRoute.peerId,
          path: [],
          auth: hmac(this.routingSecret, prefix)
        }
      } else {
        log.warn('ignoring configured route, account does not exist. prefix=%s accountId=%s', configuredRoute.targetPrefix, configuredRoute.peerId)
      }
    }

    const localRoute = this.localRoutes.get(prefix)
    if (localRoute) {
      return localRoute
    }

    const weight = (route: IncomingRoute) => {
      const relation = this.getAccountRelation(route.peer)
      return {
        parent: 0,
        peer: 1,
        child: 2,
        local: 3
      }[relation]
    }

    const bestRoute = Array.from(this.peers.values())
      .map(peer => peer.getPrefix(prefix))
      .filter((a): a is IncomingRoute => !!a)
      .sort((a: IncomingRoute, b: IncomingRoute) => {
        // First sort by peer weight
        const weightA = weight(a)
        const weightB = weight(b)

        if (weightA !== weightB) {
          return weightB - weightA
        }

        // Then sort by path length
        const pathA = a.path.length
        const pathB = b.path.length

        if (pathA !== pathB) {
          return pathA - pathB
        }

        // Finally, tie-break by accountId
        if (a.peer > b.peer) {
          return 1
        } else if (b.peer > a.peer) {
          return -1
        } else {
          return 0
        }
      })[0]

    return bestRoute && {
      nextHop: bestRoute.peer,
      path: bestRoute.path,
      auth: bestRoute.auth
    }
  }

  getGlobalPrefix () {
    switch (this.config.env) {
      case 'production':
        return 'g.'
      case 'test':
        return 'test.'
      default:
        throw new Error('invalid value for `env` config. env=' + this.config.env)
    }
  }

  sendRouteUpdate (accountId: string) {
    log.info('broadcasting to peer. accountId=%s epoch=%s', accountId, this.currentEpoch)

    const peer = this.peers.get(accountId)

    if (!peer) {
      throw new Error('peer not set. accountId=' + accountId)
    }

    const plugin = this.accounts.getPlugin(accountId)

    let lastUpdate = 0
    let sendTimer
    const send = () => {
      if (sendTimer) {
        clearTimeout(sendTimer)
        sendTimer = undefined
      }

      if (!plugin.isConnected()) {
        return
      }

      const { nextRequestedEpoch } = peer.getRequestedRouteUpdate()
      // TODO: Slicing copies that portion of the array. If we are sending a
      // large routing table in small chunks it would be much faster to loop
      // over the log and write the
      const allUpdates = this.log.slice(nextRequestedEpoch)
      const highestEpochUpdate = allUpdates.slice(allUpdates.length - 1)[0]

      const toEpoch = highestEpochUpdate
        ? highestEpochUpdate.epoch + 1
        : nextRequestedEpoch

      const relation = this.getAccountRelation(accountId)
      const updates = allUpdates
        // Don't send peer their own routes
        .filter(update => !(update.route && update.route.nextHop === accountId))

        // Don't advertise peer and provider routes to providers
        .map(update => {
          if (
            update.route &&
            relation === 'parent' &&
            ['peer', 'parent'].indexOf(this.getAccountRelation(update.route.nextHop)) !== -1
          ) {
            return {
              ...update,
              route: undefined
            }
          } else {
            return update
          }
        })

      // Don't send heartbeats more than once per routeBroadcastInterval
      const timeSinceLastUpdate = Date.now() - lastUpdate
      if (!updates.length && timeSinceLastUpdate < this.config.routeBroadcastInterval) {
        sendTimer = setTimeout(send, this.config.routeBroadcastInterval - timeSinceLastUpdate)
        return
      }

      const newRoutes: BroadcastRoute[] = []
      const withdrawnRoutes: { prefix: string, epoch: number }[] = []

      for (const update of updates) {
        if (update.route) {
          newRoutes.push({
            prefix: update.prefix,
            nextHop: update.route.nextHop,
            path: update.route.path,
            auth: update.route.auth
          })
        } else {
          withdrawnRoutes.push({
            prefix: update.prefix,
            epoch: update.epoch
          })
        }
      }

      // Some plugins may not support timeouts, so we make sure we don't get stuck
      const timeout = this.config.routeBroadcastInterval

      const timerPromise = new Promise(resolve => {
        const timer = setTimeout(resolve, timeout)
        // Don't let this timer keep Node running
        timer.unref()
      })

      lastUpdate = Date.now()

      Promise.race([
        peer.sendRouteUpdate({
          accounts: this.accounts,
          newRoutes,
          withdrawnRoutes,
          holdDownTime: this.config.routeExpiry,
          routingTableId: this.routingTableId,
          fromEpoch: nextRequestedEpoch,
          toEpoch,
          timeout
        }),
        timerPromise
      ])
        .then(send)
        .catch((err: any) => {
          const errInfo = (err instanceof Object && err.stack) ? err.stack : err
          log.debug('failed to broadcast route information to peer. peer=%s error=%s', peer.getAccountId(), errInfo)
          // Don't immediately retry to avoid an infinite loop
          sendTimer = setTimeout(send, this.config.routeBroadcastInterval)
          sendTimer.unref()
        })
    }

    plugin.on('connect', () => {
      // some plugins don't set `isConnected() = true` before emitting the
      // connect event, setImmediate has a good chance of working.
      setImmediate(send)
    })
    send()
  }

  private updateLocalRoute (prefix: string, route?: Route) {
    const currentBest = this.localRoutingTable.get(prefix)
    const currentNextHop = currentBest && currentBest.nextHop
    const newNextHop = route && route.nextHop

    if (newNextHop !== currentNextHop) {
      if (route) {
        log.debug('new best route for prefix. prefix=%s oldBest=%s newBest=%s', prefix, currentNextHop, newNextHop)
        this.localRoutingTable.insert(prefix, route)
      } else {
        log.debug('no more route available for prefix. prefix=%s', prefix)
        this.localRoutingTable.delete(prefix)
      }

      this.updateMasterRoute(prefix, route)

      return true
    }

    return false
  }

  private updateMasterRoute (prefix: string, route?: Route) {
    if (route) {
      route = {
        ...route,
        path: [this.accounts.getOwnAddress(), ...route.path],
        auth: sha256(route.auth)
      }

      if (
        // Routes must start with the global prefix
        !prefix.startsWith(this.getGlobalPrefix()) ||

        // Don't publish the default route
        prefix === this.getGlobalPrefix() ||

        // Don't advertise local customer routes that we originated. Packets for
        // these destinations should still reach us because we are advertising our
        // own address as a prefix.
        (
          prefix.startsWith(this.accounts.getOwnAddress() + '.') &&
          route.path.length === 1
        )
      ) {
        route = undefined
      }
    }

    const currentBest = this.masterRoutingTable.get(prefix)

    const currentNextHop = currentBest && currentBest.nextHop
    const newNextHop = route && route.nextHop

    if (currentNextHop !== newNextHop) {
      if (route) {
        this.masterRoutingTable.insert(prefix, route)
      } else {
        this.masterRoutingTable.delete(prefix)
      }

      const epoch = this.currentEpoch++
      const routeUpdate: RouteUpdate = {
        prefix,
        route,
        epoch
      }
      log.debug('logging route update. update=%j', routeUpdate)

      this.log[epoch] = routeUpdate
    }
  }
}
