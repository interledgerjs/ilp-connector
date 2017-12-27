'use strict'

const log = require('../common').log.create('route-broadcaster')
const { find } = require('lodash')
const RoutingTable = require('./routing-table')
const RateBackend = require('./rate-backend')
const Accounts = require('./accounts')
const Quoter = require('./quoter')
const Config = require('./config')

const Peer = require('../routing/peer')

class RouteBroadcaster {
  constructor (deps) {
    this.routingTable = deps(RoutingTable)
    this.backend = deps(RateBackend)
    this.accounts = deps(Accounts)
    this.quoter = deps(Quoter)
    this.config = deps(Config)

    this.peers = new Map() // peerAddress:string -> peer:Peer
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

  add (address) {
    if (this.peers.get(address)) {
      // don't log duplicates
      return
    }
    if (this.config && this.config.peers && this.config.peers.length &&
      this.config.peers.indexOf(address) === -1) {
      // when using an explicitly configured list of peers,
      // only allow peers that are listed
      log.info('peer is not listed in configuration, ignoring. peerAddress=%s', address)
      return
    }
    if (address.startsWith(this.config.address)) {
      log.debug('not broadcasting routes to downstream account; override with CONNECTOR_PEERS. peerAddress=%s myAddress=%s', address, this.config.address)
      return
    }
    if (this.config.address.startsWith(address)) {
      log.debug('not broadcasting routes to upstream account; override with CONNECTOR_PEERS. peerAddress=%s myAddress=%s', address, this.config.address)
    }
    log.debug('add peer. peerAddress=' + address)
    this.peers.set(address, new Peer({ address }))
  }

  remove (address) {
    const peer = this.peers.get(address)

    if (!peer) {
      return
    }

    log.info('remove peer. peerAddress=' + address)
    this.peers.delete(address)

    for (let prefix of peer.getPrefixes()) {
      this.updatePrefix(prefix)
    }
    this.updatePrefix(address)
  }

  handleRouteUpdate (sourceAddress, {
    newRoutes,
    unreachableThroughMe,
    requestFullTable,
    holdDownTime
  }) {
    log.debug('received routes. sender=%s newRoutes=%s unreachableThroughMe=%s requestFullTable=%s holdDownTime=%s', sourceAddress, newRoutes.length, unreachableThroughMe.length, requestFullTable, holdDownTime)

    const peer = this.peers.get(sourceAddress)

    if (!peer) {
      log.info('received route update from non-peer. sourceAddress=%s', sourceAddress)
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

    const localPrefixes = this.accounts.getPrefixes()
    const configuredPrefixes = this.config.routes.map(r => r.targetPrefix)

    for (let prefix of localPrefixes.concat(configuredPrefixes)) {
      this.updatePrefix(prefix)
    }
  }

  updatePrefix (prefix) {
    const currentBest = this.routingTable.get(prefix)
    const newBest = this.getBestPeerForPrefix(prefix)

    if (newBest !== currentBest) {
      const epoch = ++this.currentEpoch
      this.routeEpochs[prefix] = epoch

      if (newBest) {
        log.debug('new best route for prefix. prefix=%s oldBest=%s newBest=%s epoch=%s', prefix, currentBest, newBest, epoch)

        this.routingTable.insert(prefix, newBest)
        this.formerRoutes.delete(prefix)

        const peer = this.peers.get(newBest)
        const route = peer && peer.getPrefix(prefix)
        if (route && route.curve) {
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
    } else {
      log.debug('prefix unchanged. prefix=%s', prefix)
    }

    return false
  }

  getBestPeerForPrefix (prefix) {
    // configured routes have highest priority
    const configuredRoute = find(this.config.routes, { targetPrefix: prefix })
    if (configuredRoute) {
      return configuredRoute.peerAddress
    }

    // next are local routes
    if (this.accounts.getPlugin(prefix)) {
      return prefix
    }

    let bestRoute = { distance: Infinity }
    for (let peer of this.peers.values()) {
      const peerRoute = peer.getPrefix(prefix)

      if (peerRoute && peerRoute.distance < bestRoute.distance) {
        bestRoute = peerRoute
      }
    }

    return bestRoute.peer
  }

  async broadcast (requestFullTable = false) {
    const peers = Array.from(this.peers.values())
    if (!peers.length) {
      return
    }

    log.info('broadcasting to %d peers. epoch=%s', peers.length, this.currentEpoch)

    const routes = this.routingTable.keys().map(prefix => ({
      prefix,
      nextHop: this.routingTable.get(prefix),
      epoch: this.routeEpochs[prefix]
    }))
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
        .catch(err => {
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

RouteBroadcaster.Peer = Peer

module.exports = RouteBroadcaster
