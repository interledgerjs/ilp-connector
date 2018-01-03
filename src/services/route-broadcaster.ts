'use strict'

import { create as createLogger } from '../common/log'
const log = createLogger('route-broadcaster')
const { find } = require('lodash')
import RoutingTable from './routing-table'
import RateBackend from './rate-backend'
import Accounts from './accounts'
import Quoter from './quoter'
import Config from './config'
import Peer from '../routing/peer'
import { Route, BroadcastRoute, RouteUpdateParams, IncomingRoute } from '../types/routing'
import reduct = require('reduct')

export default class RouteBroadcaster {
  protected routingTable: RoutingTable
  protected backend: RateBackend
  protected accounts: Accounts
  protected quoter: Quoter
  protected config: Config

  protected peers: Map<string, Peer>
  protected localRoutes: Map<string, Route>
  protected currentEpoch: number
  protected formerRoutes: Set<string>
  protected routeEpochs: { [key: string]: number }

  constructor (deps: reduct.Injector) {
    this.routingTable = deps(RoutingTable)
    this.backend = deps(RateBackend)
    this.accounts = deps(Accounts)
    this.quoter = deps(Quoter)
    this.config = deps(Config)

    this.peers = new Map() // peerId:string -> peer:Peer
    this.localRoutes = new Map()
    this.currentEpoch = 0
    this.formerRoutes = new Set()
    this.routeEpochs = {}
  }

  async start () {
    try {
      await this.reloadLocalRoutes()
      this.broadcast(true)
    } catch (e) {
      if (e.name === 'SystemError' ||
          e.name === 'ServerError') {
        // System error, in that context that is a network error
        // This will be retried later, so do nothing
      } else {
        throw e
      }
    }
    this.broadcastSoon()
  }

  add (accountId: string) {
    if (this.peers.get(accountId)) {
      // don't log duplicates
      return
    }
    if (this.config && this.config.peers && this.config.peers.length &&
      this.config.peers.indexOf(accountId) === -1) {
      // when using an explicitly configured list of peers,
      // only allow peers that are listed
      log.info('peer is not listed in configuration, ignoring. peerId=%s', accountId)
      return
    }
    const accountInfo = this.accounts.getInfo(accountId)
    if (accountInfo.relation === 'child') {
      log.debug('not broadcasting routes to child connector; change account `relation` or override with CONNECTOR_PEERS. peerId=%s myAddress=%s', accountId, this.config.ilpAddress)
      return
    }
    if (accountInfo.relation === 'parent') {
      log.debug('not broadcasting routes to parent connector; change account `relation` or override with CONNECTOR_PEERS. peerId=%s myAddress=%s', accountId, this.config.ilpAddress)
    }
    log.debug('add peer. peerId=' + accountId)
    this.peers.set(accountId, new Peer({ accountId }))
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
    newRoutes,
    unreachableThroughMe,
    requestFullTable,
    holdDownTime
  }: RouteUpdateParams) {
    log.debug('received routes. sender=%s newRoutes=%s unreachableThroughMe=%s requestFullTable=%s holdDownTime=%s', sourceAccount, newRoutes.length, unreachableThroughMe.length, requestFullTable, holdDownTime)

    const peer = this.peers.get(sourceAccount)

    if (!peer) {
      log.info('received route update from non-peer. sourceAccount=%s', sourceAccount)
      return
    }

    const changedPrefixes = peer.applyRouteUpdate({
      newRoutes,
      unreachableThroughMe,
      requestFullTable,
      holdDownTime
    })

    let haveRoutesChanged
    for (let prefix of changedPrefixes) {
      haveRoutesChanged = this.updatePrefix(prefix) || haveRoutesChanged
    }
    if (haveRoutesChanged && this.config.routeBroadcastEnabled) {
      // this.routeBroadcaster.markAccountsUnreachable(lostLedgerLinks)
      // this.routeBroadcaster.broadcast()
      //   .catch(function (err) {
      //     log.warn('error broadcasting routes: ' + err.message)
      //   })
    }
  }

  reloadLocalRoutes () {
    log.debug('reload local and configured routes.')

    this.localRoutes = new Map()
    const localAccounts = this.accounts.getAccountIds()

    for (let accountId of localAccounts) {
      const info = this.accounts.getInfo(accountId)
      switch (info.relation) {
        case 'parent':
          this.localRoutes.set('', {
            nextHop: accountId,
            path: []
          })
          break
        case 'peer':
          // For peers, we rely on their route updates
          break
        case 'child':
          this.localRoutes.set(this.accounts.getChildAddress(accountId), {
            nextHop: accountId,
            path: []
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
    const currentBest = this.routingTable.get(prefix)
    const newBest = this.getBestPeerForPrefix(prefix)

    const currentNextHop = currentBest && currentBest.nextHop
    const newNextHop = newBest && newBest.nextHop

    if (newNextHop !== currentNextHop) {
      const epoch = ++this.currentEpoch
      this.routeEpochs[prefix] = epoch

      if (newBest) {
        log.debug('new best route for prefix. prefix=%s oldBest=%s newBest=%s epoch=%s', prefix, currentNextHop, newNextHop, epoch)

        this.routingTable.insert(prefix, newBest)
        this.formerRoutes.delete(prefix)

        const peer = this.peers.get(newNextHop)
        const route = peer && peer.getPrefix(prefix)
        if (peer && route && route.curve) {
          this.quoter.cacheCurve({
            prefix,
            curve: route.curve,
            expiry: peer.getExpiry(),
            minMessageWindow: route.minMessageWindow
          })
        }
      } else {
        log.debug('no more route available for prefix. prefix=%s epoch=%s', prefix, epoch)
        this.routingTable.delete(prefix)
        this.formerRoutes.add(prefix)
      }
      return true
    }

    return false
  }

  getBestPeerForPrefix (prefix: string) {
    // configured routes have highest priority
    const configuredRoute = find(this.config.routes, { targetPrefix: prefix })
    if (configuredRoute) {
      if (this.accounts.exists(configuredRoute.peerId)) {
        return {
          nextHop: configuredRoute.peerId,
          path: []
        }
      } else {
        log.warn('ignoring configured route, account does not exist. prefix=%s accountId=%s', configuredRoute.targetPrefix, configuredRoute.peerId)
      }
    }

    const localRoute = this.localRoutes.get(prefix)
    if (localRoute) {
      return localRoute
    }

    let bestRoute: IncomingRoute | undefined = undefined
    let bestDistance = Infinity
    for (let peer of this.peers.values()) {
      const peerRoute = peer.getPrefix(prefix)

      if (peerRoute && peerRoute.path.length < bestDistance) {
        bestRoute = peerRoute
        bestDistance = peerRoute.path.length
      }
    }

    return bestRoute && {
      nextHop: bestRoute.peer,
      path: bestRoute.path
    }
  }

  async broadcast (requestFullTable = false) {
    const peers = Array.from(this.peers.values())
    if (!peers.length) {
      return
    }

    log.info('broadcasting to %d peers. epoch=%s', peers.length, this.currentEpoch)

    const selfRoute: BroadcastRoute = {
      prefix: this.accounts.getOwnAddress(),
      // no next hop, since we are the final destination for this route
      nextHop: '',
      epoch: 0,
      path: []
    }

    const routingTableRoutes = this.routingTable.keys().map((prefix: string): BroadcastRoute => {
      const entry = this.routingTable.get(prefix)
      return {
        prefix,
        nextHop: entry.nextHop,
        epoch: this.routeEpochs[prefix],
        path: entry.path
      }
    })

    const routes = [selfRoute, ...routingTableRoutes]
    const unreachableAccounts = Array.from(this.formerRoutes).map(prefix => ({
      prefix,
      epoch: this.routeEpochs[prefix]
    }))

    // Some plugins may not support timeouts, so we make sure we don't get stuck
    const timeout = this.config.routeBroadcastInterval

    // Using Promise.all to ensure all route broadcasts are sent in parallel.
    const broadcastPromise = Promise.all(peers.map(peer => {
      return peer.broadcastRoutes({
        accounts: this.accounts,
        routes,
        unreachableAccounts,
        holdDownTime: this.config.routeExpiry,
        broadcastCurves: this.config.broadcastCurves,
        requestFullTable,
        currentEpoch: this.currentEpoch,
        timeout
      })
        .catch((err: any) => {
          const errInfo = (err instanceof Object && err.stack) ? err.stack : err
          log.debug('failed to broadcast route information to peer. peer=%s error=%s', peer.getAddress(), errInfo)
        })
    }))

    await new Promise(resolve => {
      const timeoutId = setTimeout(resolve, timeout)
      broadcastPromise.then(() => {
        clearTimeout(timeoutId)
        resolve()
      })
    })
  }

  async broadcastSoon () {
    await new Promise(resolve => setTimeout(resolve, this.config.routeBroadcastInterval))

    try {
      await this.reloadLocalRoutes()
      await this.broadcast()
    } catch (err) {
      log.warn('broadcasting routes failed')
      log.debug(err)
    }

    await this.broadcastSoon()
  }
}
