import { randomBytes } from 'crypto'
import { Errors } from 'ilp-packet'
import { create as createLogger } from '../common/log'
const log = createLogger('route-broadcaster')
import { find } from 'lodash'
import RoutingTable from './routing-table'
import ForwardingRoutingTable, { RouteUpdate } from './forwarding-routing-table'
import Accounts from './accounts'
import Config from './config'
import Peer from '../routing/peer'
import { canDragonFilter } from '../routing/dragon'
import { Relation, getRelationPriority } from '../routing/relation'
import {
  formatRoutingTableAsJson,
  formatRouteAsJson
} from '../routing/utils'
import {
  Route,
  IncomingRoute
} from '../types/routing'
import reduct = require('reduct')
import { sha256, hmac } from '../lib/utils'
import {
  CcpRouteControlRequest,
  CcpRouteUpdateRequest
} from 'ilp-protocol-ccp'
const { BadRequestError } = Errors

export default class RouteBroadcaster {
  private deps: reduct.Injector
  // Local routing table, used for actually routing packets
  private localRoutingTable: RoutingTable
  // Master routing table, used for routes that we broadcast
  private forwardingRoutingTable: ForwardingRoutingTable

  private accounts: Accounts
  private config: Config

  private peers: Map<string, Peer>
  private localRoutes: Map<string, Route>
  private routingSecret: Buffer
  private untrackCallbacks: Map<string, () => void> = new Map()

  constructor (deps: reduct.Injector) {
    this.deps = deps
    this.localRoutingTable = deps(RoutingTable)
    this.forwardingRoutingTable = deps(ForwardingRoutingTable)
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
  }

  start () {
    this.reloadLocalRoutes()

    for (const accountId of this.accounts.getAccountIds()) {
      this.track(accountId)
    }
  }

  stop () {
    for (const accountId of this.peers.keys()) {
      this.remove(accountId)
    }
  }

  track (accountId: string) {
    if (this.untrackCallbacks.has(accountId)) {
      // Already tracked
      return
    }

    const plugin = this.accounts.getPlugin(accountId)

    const connectHandler = () => {
      if (!plugin.isConnected()) {
        // some plugins don't set `isConnected() = true` before emitting the
        // connect event, setImmediate has a good chance of working.
        log.error('(!!!) plugin emitted connect, but then returned false for isConnected, broken plugin. account=%s', accountId)
        setImmediate(() => this.add(accountId))
      } else {
        this.add(accountId)
      }
    }
    const disconnectHandler = () => {
      this.remove(accountId)
    }

    plugin.on('connect', connectHandler)
    plugin.on('disconnect', disconnectHandler)

    this.untrackCallbacks.set(accountId, () => {
      plugin.removeListener('connect', connectHandler)
      plugin.removeListener('disconnect', disconnectHandler)
    })

    this.add(accountId)
  }

  untrack (accountId: string) {
    this.remove(accountId)

    const callback = this.untrackCallbacks.get(accountId)

    if (callback) {
      callback()
    }
  }

  add (accountId: string) {
    const existingPeer = this.peers.get(accountId)
    if (existingPeer) {
      // Every time we reconnect, we'll send a new route control message to make
      // sure they are still sending us routes.
      const receiver = existingPeer.getReceiver()

      if (receiver) {
        receiver.sendRouteControl()
      } else {
        log.warn('unable to send route control message, receiver object undefined. peer=%s', existingPeer)
      }

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
      const plugin = this.accounts.getPlugin(accountId)

      if (plugin.isConnected()) {
        log.debug('add peer. accountId=%s sendRoutes=%s receiveRoutes=%s', accountId, sendRoutes, receiveRoutes)
        const peer = new Peer({ deps: this.deps, accountId, sendRoutes, receiveRoutes })
        this.peers.set(accountId, peer)
        const receiver = peer.getReceiver()
        if (receiver) {
          receiver.sendRouteControl()
        }
        this.reloadLocalRoutes()
      }
    } else {
      log.debug('not sending/receiving routes for peer, set sendRoutes/receiveRoutes to override. accountId=%s', accountId)
    }
  }

  remove (accountId: string) {
    const peer = this.peers.get(accountId)

    if (!peer) {
      return
    }

    const sender = peer.getSender()
    const receiver = peer.getReceiver()

    log.info('remove peer. peerId=' + accountId)
    if (sender) {
      sender.stop()
    }

    // We have to remove the peer before calling updatePrefix on each of its
    // advertised prefixes in order to find the next best route.
    this.peers.delete(accountId)
    if (receiver) {
      for (let prefix of receiver.getPrefixes()) {
        this.updatePrefix(prefix)
      }
    }
    if (this.getAccountRelation(accountId) === 'child') {
      this.updatePrefix(this.accounts.getChildAddress(accountId))
    }
  }

  handleRouteControl (sourceAccount: string, routeControl: CcpRouteControlRequest) {
    const peer = this.peers.get(sourceAccount)

    if (!peer) {
      log.info('received route control message from non-peer. sourceAccount=%s', sourceAccount)
      throw new BadRequestError('cannot process route control messages from non-peers.')
    }

    const sender = peer.getSender()

    if (!sender) {
      log.info('received route control message from peer not authorized to receive routes from us (sendRoutes=false). sourceAccount=%s', sourceAccount)
      throw new BadRequestError('rejecting route control message, we are configured not to send routes to you.')
    }

    sender.handleRouteControl(routeControl)
  }

  handleRouteUpdate (sourceAccount: string, routeUpdate: CcpRouteUpdateRequest) {
    const peer = this.peers.get(sourceAccount)

    if (!peer) {
      log.info('received route update from non-peer. sourceAccount=%s', sourceAccount)
      throw new BadRequestError('cannot process route update messages from non-peers.')
    }

    const receiver = peer.getReceiver()

    if (!receiver) {
      log.info('received route update from peer not authorized to advertise routes to us (receiveRoutes=false). sourceAccount=%s', sourceAccount)
      throw new BadRequestError('rejecting route update, we are configured not to receive routes from you.')
    }

    // Apply import filters
    // TODO Route filters should be much more configurable
    // TODO We shouldn't modify this object in place
    routeUpdate.newRoutes = routeUpdate.newRoutes
      // Filter incoming routes that aren't part of the current global prefix or
      // cover the entire global prefix (i.e. the default route.)
      .filter(route =>
        route.prefix.startsWith(this.getGlobalPrefix()) &&
        route.prefix.length > this.getGlobalPrefix().length
      )

    const changedPrefixes = receiver.handleRouteUpdate(routeUpdate)

    let haveRoutesChanged
    for (const prefix of changedPrefixes) {
      haveRoutesChanged = this.updatePrefix(prefix) || haveRoutesChanged
    }
    if (haveRoutesChanged && this.config.routeBroadcastEnabled) {
      // TODO: Should we even trigger an immediate broadcast when routes change?
      //       Note that BGP does not do this AFAIK
      for (const peer of this.peers.values()) {
        const sender = peer.getSender()
        if (sender) {
          sender.scheduleRouteUpdate()
        }
      }
    }
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
      if (this.getAccountRelation(accountId) === 'child') {
        const childAddress = this.accounts.getChildAddress(accountId)
        this.localRoutes.set(childAddress, {
          nextHop: accountId,
          path: [],
          auth: hmac(this.routingSecret, childAddress)
        })
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
      return getRelationPriority(relation)
    }

    const bestRoute = Array.from(this.peers.values())
      .map(peer => peer.getReceiver())
      .map(receiver => receiver && receiver.getPrefix(prefix))
      .filter((a): a is IncomingRoute => !!a)
      .sort((a?: IncomingRoute, b?: IncomingRoute) => {
        if (!a && !b) {
          return 0
        } else if (!a) {
          return 1
        } else if (!b) {
          return -1
        }

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
        return 'g'
      case 'test':
        return 'test'
      default:
        throw new Error('invalid value for `env` config. env=' + this.config.env)
    }
  }

  getStatus () {
    return {
      routingTableId: this.forwardingRoutingTable.routingTableId,
      currentEpoch: this.forwardingRoutingTable.currentEpoch,
      localRoutingTable: formatRoutingTableAsJson(this.localRoutingTable),
      forwardingRoutingTable: formatRoutingTableAsJson(this.forwardingRoutingTable),
      routingLog: this.forwardingRoutingTable.log.map(entry => ({
        ...entry,
        route: entry.route && formatRouteAsJson(entry.route)
      })),
      peers: Array.from(this.peers.values()).reduce((acc, peer) => {
        const sender = peer.getSender()
        const receiver = peer.getReceiver()
        acc[peer.getAccountId()] = {
          send: sender && sender.getStatus(),
          receive: receiver && receiver.getStatus()
        }
        return acc
      }, {})
    }
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

      this.updateForwardingRoute(prefix, route)

      return true
    }

    return false
  }

  private updateForwardingRoute (prefix: string, route?: Route) {
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
        ) ||

        canDragonFilter(
          this.forwardingRoutingTable,
          this.getAccountRelation,
          prefix,
          route
        )
      ) {
        route = undefined
      }
    }

    const currentBest = this.forwardingRoutingTable.get(prefix)

    const currentNextHop = currentBest && currentBest.nextHop
    const newNextHop = route && route.nextHop

    if (currentNextHop !== newNextHop) {
      if (route) {
        this.forwardingRoutingTable.insert(prefix, route)
      } else {
        this.forwardingRoutingTable.delete(prefix)
      }

      const epoch = this.forwardingRoutingTable.currentEpoch++
      const routeUpdate: RouteUpdate = {
        prefix,
        route,
        epoch
      }
      log.debug('logging route update. update=%j', routeUpdate)

      this.forwardingRoutingTable.log[epoch] = routeUpdate

      if (route) {
        // We need to re-check any prefixes that start with this prefix to see
        // if we can apply DRAGON filtering.
        //
        // Note that we do this check *after* we have added the new route above.
        const subPrefixes = this.forwardingRoutingTable.getKeysStartingWith(prefix)

        for (const subPrefix of subPrefixes) {
          if (subPrefix === prefix) continue

          this.updateForwardingRoute(subPrefix, this.forwardingRoutingTable.get(subPrefix))
        }
      }
    }
  }

  private getAccountRelation = (accountId: string): Relation => {
    return accountId ? this.accounts.getInfo(accountId).relation : 'local'
  }
}
