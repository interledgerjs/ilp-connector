'use strict'

const _ = require('lodash')
const co = require('co')
const defer = require('co-defer')
const Route = require('ilp-routing').Route
const log = require('../common').log.create('route-broadcaster')
const SIMPLIFY_POINTS = 10
const PEER_LEDGER_PREFIX = 'peer.'

class RouteBroadcaster {
  /**
   * @param {RoutingTables} routingTables
   * @param {Backend} backend
   * @param {Ledgers} ledgers
   * @param {Object} config
   * @param {Number} config.minMessageWindow
   * @param {Number} config.routeCleanupInterval
   * @param {Number} config.routeBroadcastInterval
   * @param {Boolean} config.autoloadPeers
   * @param {URI[]} config.peers
   * @param {Object} config.ledgerCredentials
   */
  constructor (routingTables, backend, ledgers, config) {
    if (!ledgers) {
      throw new TypeError('Must be given a valid Ledgers instance')
    }

    this.routeCleanupInterval = config.routeCleanupInterval
    this.routeBroadcastInterval = config.routeBroadcastInterval
    this.routingTables = routingTables
    this.backend = backend
    this.ledgers = ledgers
    this.minMessageWindow = config.minMessageWindow
    this.ledgerCredentials = config.ledgerCredentials
    this.configRoutes = config.configRoutes

    this.autoloadPeers = config.autoloadPeers
    this.defaultPeers = config.peers
    // peersByLedger is stored in the form { ledgerPrefix ⇒ { connectorAddress ⇒ true } }
    // Note that the connectorAddress must be the full ILP address, including the ledgerPrefix
    this.peersByLedger = {}

    this.peerEpochs = {} // { adjacentConnector ⇒ int } the last broadcast-epoch we successfully informed a peer in
    this.holdDownTime = config.routeExpiry // todo? replace 'expiry' w/ hold-down or just reappropriate the term?
    if (!this.holdDownTime) {
      throw new Error('no holdDownTime')
    }
    if (this.routeBroadcastInterval >= this.holdDownTime) {
      throw new Error('holdDownTime must be greater than routeBroadcastInterval or routes will expire between broadcasts!')
    }
    this.detectedDown = new Set()
    this.lastNewRouteSentAt = Date.now()
  }

  * start () {
    yield this.crawl()
    try {
      yield this.reloadLocalRoutes()
      yield this.addConfigRoutes()
      this.broadcast()
    } catch (e) {
      if (e.name === 'SystemError' ||
          e.name === 'ServerError') {
        // System error, in that context that is a network error
        // This will be retried later, so do nothing
      } else {
        throw e
      }
    }
    this.removeExpiredRoutesSoon()
    this.broadcastSoon()
  }

  removeExpiredRoutesSoon () {
    setTimeout(() => {
      try {
        let lostLedgerLinks = this.routingTables.removeExpiredRoutes()
        this.markLedgersUnreachable(lostLedgerLinks)
      } catch (err) {
        log.warn('removing expired routes failed')
        log.debug(err)
      }
    }, this.routeCleanupInterval)
  }

  markLedgersUnreachable (lostLedgerLinks) {
    if (lostLedgerLinks.length > 0) log.info('detected lostLedgerLinks:', lostLedgerLinks)
    lostLedgerLinks.forEach((unreachableLedger) => { this.detectedDown.add(unreachableLedger) })
  }
  _currentEpoch () {
    return this.routingTables.publicTables.currentEpoch
  }

  broadcastSoon () {
    defer.setTimeout(function * () {
      try {
        this.routingTables.removeExpiredRoutes()
        yield this.reloadLocalRoutes()
        yield this.broadcast()
      } catch (err) {
        log.warn('broadcasting routes failed')
        log.debug(err)
      }
      this.broadcastSoon()
    }.bind(this), this.routeBroadcastInterval)
  }

  broadcast () {
    const adjacentLedgers = Object.keys(this.peersByLedger)
    const routes = this.routingTables.toJSON(SIMPLIFY_POINTS).filter(route => {
      const isPeerRoute = (route.destination_ledger.startsWith(PEER_LEDGER_PREFIX))
      return !isPeerRoute
    })
    log.debug('broadcasting to %d adjacent ledgers', adjacentLedgers.length)
    const unreachableLedgers = Array.from(this.detectedDown)
    this.detectedDown.clear()
    if (unreachableLedgers.length > 0) {
      log.info('broadcast unreachableLedgers:', unreachableLedgers)
    }

    return Promise.all(adjacentLedgers.map((adjacentLedger) => {
      const ledgerRoutes = routes.filter((route) => route.source_ledger === adjacentLedger)
      return this._broadcastToLedger(adjacentLedger, ledgerRoutes, unreachableLedgers)
        .catch((err) => {
          log.warn('broadcasting routes on ledger ' + adjacentLedger + ' failed')
          log.debug(err)
        })
    }))
  }

  _broadcastToLedger (adjacentLedger, routes, unreachableLedgers) {
    const connectors = Object.keys(this.peersByLedger[adjacentLedger])
    return Promise.all(connectors.map((account) => {
      log.info('broadcasting ' + routes.length + ' routes to ' + account)
      let routesNewToConnector = routes.filter((route) => (route.added_during_epoch > (this.peerEpochs[account] || -1)))
      const newRoutes = routesNewToConnector.map((route) => _.omit(route, ['added_during_epoch']))
      if (unreachableLedgers.length > 0) log.info('_broadcastToLedger unreachableLedgers:', unreachableLedgers)

      const broadcastPromise = this.ledgers.getPlugin(adjacentLedger).sendMessage({
        ledger: adjacentLedger,
        from: this.ledgers.getPlugin(adjacentLedger).getAccount(),
        to: account,
        data: {
          method: 'broadcast_routes',
          data: {
            new_routes: newRoutes,
            hold_down_time: this.holdDownTime,
            unreachable_through_me: unreachableLedgers
          }
        }
      })
      // timeout the plugin.sendMessage Promise just so we don't have it hanging around forever
      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('route broadcast to ' + account + ' timed out')), this.routeBroadcastInterval)
      })

      // We are deliberately calling an async function synchronously because
      // we do not want to wait for the routes to be broadcasted before continuing.
      // Even if there is an error sending a specific route or a sendMessage promise hangs,
      // we should continue sending the other broadcasts out
      return Promise.race([broadcastPromise, timeoutPromise])
        .then((val) => {
          this.peerEpochs[account] = this._currentEpoch()
        })
        .catch((err) => {
          let lostLedgerLinks = this.routingTables.invalidateConnector(account)
          log.info('detectedDown! account:', account, 'lostLedgerLinks:', lostLedgerLinks)
          this.markLedgersUnreachable(lostLedgerLinks)
          // todo: it would be better for the possibly-just-netsplit connector to report its last seen version of this connector's ledger
          this.peerEpochs[account] = -1
          log.warn('broadcasting routes to ' + account + ' failed')
          log.debug(err)
        })
    }))
  }

  crawl () {
    return this.ledgers.getClients().map(this._crawlClient, this)
  }

  * _crawlClient (client) {
    yield this._crawlLedgerPlugin(client.getPlugin())
  }

  * _crawlLedgerPlugin (plugin) {
    if (!plugin.isConnected()) {
      plugin.once('connect', () => this._crawlLedgerPlugin(plugin))
      return
    }
    const localAccount = plugin.getAccount()
    const info = plugin.getInfo()
    const prefix = info.prefix
    for (const connector of (info.connectors || [])) {
      // Don't broadcast routes to ourselves.
      if (localAccount === connector) continue
      if (this.autoloadPeers || this.defaultPeers.indexOf(connector) !== -1) {
        this._addPeer(prefix, connector)
      }
    }

    // Add peers from config if their prefixes match the ledger,
    // even if they are not returned in the ledger info
    for (const connector of this.defaultPeers) {
      if (connector.indexOf(prefix) === 0) {
        this._addPeer(prefix, connector)
      }
    }
  }

  _addPeer (prefix, connector) {
    if (!this.peersByLedger[prefix]) {
      this.peersByLedger[prefix] = {}
    }
    if (this.peersByLedger[prefix][connector]) {
      // don't log duplicates
      return
    }
    this.peersByLedger[prefix][connector] = true
    log.info('adding peer ' + connector + ' via ledger ' + prefix)
  }

  depeerLedger (prefix) {
    delete this.peersByLedger[prefix]
  }

  * reloadLocalRoutes () {
    const localRoutes = yield this._getLocalRoutes()
    this.routingTables.addLocalRoutes(this.ledgers, localRoutes)
  }

  _getLocalRoutes () {
    return Promise.all(this.ledgers.getPairs().map(
      (pair) => co.wrap(this._tradingPairToLocalRoute).call(this, pair)
    )).then(
      (localRoutes) => localRoutes.filter((route) => !!route)
    )
  }

  addConfigRoutes () {
    for (let configRoute of this.configRoutes) {
      const connectorLedger = configRoute.connectorLedger
      const connector = configRoute.connectorAccount
      const targetPrefix = configRoute.targetPrefix

      const route = new Route(
        // use a 1:1 curve as a placeholder (it will be overwritten by a remote quote)
        [ [0, 0], [Number.MAX_VALUE, Number.MAX_VALUE] ],
        // the nextLedger is inserted to make sure this the hop to the
        // connectorLedger is not considered final.
        {
          sourceLedger: connectorLedger,
          nextLedger: targetPrefix,
          minMessageWindow: this.minMessageWindow,
          sourceAccount: connector,
          targetPrefix: targetPrefix })

      // set the noExpire option to true when adding config routes
      this.routingTables.addRoute(route, true)
    }

    // returns a promise in order to be similar to reloadLocalRoutes()
    return Promise.resolve(null)
  }

  * _tradingPairToLocalRoute (pair) {
    const sourceLedger = pair[0].split('@').slice(1).join('@')
    const destinationLedger = pair[1].split('@').slice(1).join('@')
    const sourceCurrency = pair[0].split('@')[0]
    const destinationCurrency = pair[1].split('@')[0]
    const sourcePlugin = this.ledgers.getPlugin(sourceLedger)
    const destinationPlugin = this.ledgers.getPlugin(destinationLedger)
    // `backend.getCurve()` may need `plugin.getInfo()`
    if (!sourcePlugin.isConnected() || !destinationPlugin.isConnected()) return

    const curve = yield this.backend.getCurve({
      source_ledger: sourceLedger,
      destination_ledger: destinationLedger,
      source_currency: sourceCurrency,
      destination_currency: destinationCurrency
    })
    return Route.fromData({
      source_ledger: sourceLedger,
      destination_ledger: destinationLedger,
      additional_info: curve.additional_info,
      min_message_window: this.minMessageWindow,
      source_account: sourcePlugin.getAccount(),
      destination_account: destinationPlugin.getAccount(),
      points: curve.points
    }, this._currentEpoch())
  }
}

module.exports = RouteBroadcaster
