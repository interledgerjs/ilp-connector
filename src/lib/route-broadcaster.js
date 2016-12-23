'use strict'

const co = require('co')
const defer = require('co-defer')
const Route = require('ilp-routing').Route
const log = require('../common').log.create('route-broadcaster')
const SIMPLIFY_POINTS = 10
const http = require('http')

class RouteBroadcaster {
  /**
   * @param {RoutingTables} routingTables
   * @param {Backend} backend
   * @param {ilp-core.Core} core
   * @param {InfoCache} infoCache
   * @param {Object} config
   * @param {Object} config.tradingPairs
   * @param {Number} config.minMessageWindow
   * @param {Number} config.routeCleanupInterval
   * @param {Number} config.routeBroadcastInterval
   * @param {Boolean} config.autoloadPeers
   * @param {URI[]} config.peers
   * @param {Object} config.ledgerCredentials
   */
  constructor (routingTables, backend, core, infoCache, config) {
    if (!core) {
      throw new TypeError('Must be given a valid Core instance')
    }

    this.routeCleanupInterval = config.routeCleanupInterval
    this.routeBroadcastInterval = config.routeBroadcastInterval
    this.routingTables = routingTables
    if (this.routingTables.publicTables.current_epoch !== 0) throw new Error("expecting a fresh routingTables with epoch support")
    this.backend = backend
    this.core = core
    this.infoCache = infoCache
    this.tradingPairs = config.tradingPairs
    this.minMessageWindow = config.minMessageWindow
    this.ledgerCredentials = config.ledgerCredentials
    this.configRoutes = config.configRoutes

    this.autoloadPeers = config.autoloadPeers
    this.defaultPeers = config.peers
    this.peersByLedger = {} // { ledgerPrefix ⇒ { connectorName ⇒ true } }

    this.peerEpochs = {} // { adjacentConnector ⇒ int } the last broadcast-epoch we successfully informed a peer in
    this.holdDownTime = config.routeExpiry // todo? replace 'expiry' w/ hold-down or just reappropriate the term?
    if (!this.holdDownTime) {
      throw new Error('no holdDownTime')
    }
    this.detectedDown = new Set()
    this.simTestingUri = config.simTestingUri
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
    log.info('cleanup interval:',this.routeCleanupInterval)
    setInterval(() => {
      let lostLedgerLinks = this.routingTables.removeExpiredRoutes()
      this.markLedgersUnreachable(lostLedgerLinks)

    }, this.routeCleanupInterval)
    // todo: one-time timer, reset until successful, rather than interval:
    setInterval(() => this.reportToSimTestingUri(), 15000)
    log.info('broadcast interval:',this.routeBroadcastInterval)
    defer.setInterval(function * () {
      //yield this.reloadLocalRoutes()
      this.broadcast()
    }.bind(this), this.routeBroadcastInterval)
  }
  markLedgersUnreachable(lostLedgerLinks) {
    if (lostLedgerLinks.length > 0) log.info('detected lostLedgerLinks:',lostLedgerLinks)
    lostLedgerLinks.map((unreachableLedger) => {this.detectedDown.add(unreachableLedger)})
  }

  reportToSimTestingUri() {
    //log.info('reportToSimTestingUri lastNewRouteSentAt:',this.lastNewRouteSentAt)
    if ((Date.now() - this.lastNewRouteSentAt) > 45000) {
      this.lastNewRouteSentAt = Infinity // only report once (for now)
      let routesJson = this.routingTables.toJSON(SIMPLIFY_POINTS)
      log.info('reportToSimTestingUri detected stable routing table:',routesJson,' adjacentLedgers:',Object.keys(this.peersByLedger))
      var postData = JSON.stringify({
        'msg' : 'stable_routes',
        'routes' : routesJson
      });

      var options = {
        hostname: 'localhost',
        port: 8042,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      var req = http.request(options, (res) => {
        console.log(`STATUS: ${res.statusCode}`);
        console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          console.log(`BODY: ${chunk}`);
        });
        res.on('end', () => {
          console.log('No more data in response.');
        });
      });

      req.on('error', (e) => {
        console.log(`problem with request: ${e.message}`);
      });

      req.write(postData);
      req.end();
    }
  }
  _currentEpoch() {
    return this.routingTables.publicTables.current_epoch
  }
  _endEpoch() {
    this.routingTables.publicTables.incrementEpoch()
  }
  broadcast () {
    const adjacentLedgers = Object.keys(this.peersByLedger)
    const routes = this.routingTables.toJSON(SIMPLIFY_POINTS)
    const unreachableLedgers = this.detectedDown.values() ; this.detectedDown.clear()
    for (let adjacentLedger of adjacentLedgers) {
      const ledgerRoutes = routes.filter((route) => (route.source_ledger === adjacentLedger))
      // todo?: remove added_during_epoch? look it up some other way?
      this._broadcastToLedger(adjacentLedger, ledgerRoutes, unreachableLedgers)
    }
    this._endEpoch()
  }

  _broadcastToLedger (adjacentLedger, routes, unreachableLedgers) {
    const connectors = Object.keys(this.peersByLedger[adjacentLedger])
    log.info('_broadcastToLedger connectors:',connectors)
    for (let adjacentConnector of connectors) {
      const account = adjacentLedger + adjacentConnector
      const routesNewToConnector = routes.filter((route) => (route.added_during_epoch > (this.peerEpochs[account] || -1)))

      log.info('broadcasting ' + routesNewToConnector.length + ' routes to ' + account)

      // timeout the plugin.sendMessage Promise just so we don't have it hanging around forever
      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('route broadcast to ' + account + ' timed out')), this.routeBroadcastInterval)
      })
      const broadcastPromise = this.core.getPlugin(adjacentLedger).sendMessage({
        ledger: adjacentLedger,
        account: account,
        data: {
          method: 'broadcast_routes',
          data: {
            routes: routesNewToConnector,
            hold_down_time: this.holdDownTime,
            unreachable_through_me: unreachableLedgers
          }
        }
      })

      // We are deliberately calling an async function synchronously because
      // we do not want to wait for the routes to be broadcasted before continuing.
      // Even if there is an error sending a specific route or a sendMessage promise hangs,
      // we should continue sending the other broadcasts out
      Promise.race([broadcastPromise, timeoutPromise])
        .then((val) => {
          log.info('connector:',account,' successfully broadcast to for epoch:',this._currentEpoch())
          this.peerEpochs[account] = this._currentEpoch()
          // for simulation testing:
          if (routesNewToConnector.length > 0) this.lastNewRouteSentAt = Date.now()
        })
        .catch((err) => {
          log.warn('broadcasting routes to ' + account + ' failed: ', err)
          let lostLedgerLinks = this.routingTables.invalidateConnector(account)
          log.info('detectedDown! account:',account,'lostLedgerLinks:',lostLedgerLinks)
          this.markLedgersUnreachable(lostLedgerLinks)
          this.peerEpochs[account] = -1; // todo: better would be for the possibly-just-netsplit connector to report its last seen version of this connector's ledger
        })
    }
  }

  crawl () {
    return this.core.getClients().map(this._crawlClient, this)
  }

  * _crawlClient (client) {
    const prefix = yield client.getPlugin().getPrefix()
    const localAccount = yield client.getPlugin().getAccount()
    const connectors = yield client.getConnectors()
    for (const connector of connectors) {
      // Don't broadcast routes to ourselves.
      if (localAccount === prefix + connector) continue
      if (this.autoloadPeers || this.defaultPeers.indexOf(prefix + connector) !== -1) {
        this.peersByLedger[prefix] = this.peersByLedger[prefix] || {}
        this.peersByLedger[prefix][connector] = true
        log.info('adding peer ' + connector + ' via ledger ' + prefix)
      }
    }
  }

  // todo: make the true local routes not expiry, and get rid of this function
  * reloadLocalRoutes () {
    const localRoutes = yield this._getLocalRoutes()
    yield this.routingTables.addLocalRoutes(this.infoCache, localRoutes)
  }

  _getLocalRoutes () {
    return Promise.all(this.tradingPairs.toArray().map(
      (pair) => this._tradingPairToLocalRoute(pair)))
  }

  addConfigRoutes () {
    for (let configRoute of this.configRoutes) {
      const connectorLedger = configRoute.connectorLedger
      const connector = configRoute.connectorAccount
      const targetPrefix = configRoute.targetPrefix

      const route = new Route(
        // use a 1:1 curve as a placeholder (it will be overwritten by a remote quote)
        [ [0, 0], [1, 1] ],
        // the second ledger is inserted to make sure this the hop to the
        // connectorLedger is not considered final.
        [ connectorLedger, targetPrefix ],
        { minMessageWindow: this.minMessageWindow,
          sourceAccount: connector,
          targetPrefix: targetPrefix }
      )
      log.info("addConfigRoutes adding route:", route)

      this.routingTables.addRoute(route)
    }

    // returns a promise in order to be similar to reloadLocalRoutes()
    return Promise.resolve(null)
  }

  _tradingPairToLocalRoute (pair) {
    const sourceLedger = pair[0].split('@').slice(1).join('@')
    const destinationLedger = pair[1].split('@').slice(1).join('@')
    // TODO change the backend API to return curves, not points
    log.info("_tradingPairToLocalRoute sourceLedger:",sourceLedger," destinationLedger:",destinationLedger)
    return co(function * () {
      const quote = yield this.backend.getQuote({
        source_ledger: sourceLedger,
        destination_ledger: destinationLedger,
        source_amount: 100000000
      })
      return yield this._quoteToLocalRoute(quote)
    }.bind(this))
  }

  * _quoteToLocalRoute (quote) {
    const sourcePlugin = this.core.getPlugin(quote.source_ledger)
    const destinationPlugin = this.core.getPlugin(quote.destination_ledger)
    //log.info("_quoteToLocalRoute sourcePlugin:",sourcePlugin," destinationPlugin:",destinationPlugin)
    log.info("_quoteToLocalRoute current_epoch:",this._currentEpoch())
    return Route.fromData({
      source_ledger: quote.source_ledger,
      destination_ledger: quote.destination_ledger,
      additional_info: quote.additional_info,
      min_message_window: this.minMessageWindow,
      source_account: (yield sourcePlugin.getAccount()),
      destination_account: (yield destinationPlugin.getAccount()),
      points: [
        [0, 0],
        [+quote.source_amount, +quote.destination_amount]
      ]
    },this._currentEpoch())
  }
}

module.exports = RouteBroadcaster
