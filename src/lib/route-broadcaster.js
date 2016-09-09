'use strict'

const co = require('co')
const defer = require('co-defer')
const request = require('co-request')
const Route = require('five-bells-routing').Route
const SIMPLIFY_POINTS = 10

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
   */
  constructor (routingTables, backend, core, infoCache, config) {
    if (!core) {
      throw new TypeError('Must be given a valid Core instance')
    }

    this.routeCleanupInterval = config.routeCleanupInterval
    this.routeBroadcastInterval = config.routeBroadcastInterval
    this.baseURI = routingTables.baseURI
    this.routingTables = routingTables
    this.backend = backend
    this.core = core
    this.infoCache = infoCache
    this.tradingPairs = config.tradingPairs
    this.minMessageWindow = config.minMessageWindow

    this.autoloadPeers = config.autoloadPeers
    this.adjacentConnectors = {}
    config.peers.forEach(this.addConnector, this)
  }

  * start () {
    if (this.autoloadPeers) yield this.crawlLedgers()
    try {
      yield this.reloadLocalRoutes()
      yield this.broadcast()
    } catch (e) {
      if (e.name === 'SystemError' ||
          e.name === 'ServerError') {
        // System error, in that context that is a network error
        // This will be retried later, so do nothing
      } else {
        throw e
      }
    }
    setInterval(() => this.routingTables.removeExpiredRoutes(), this.routeCleanupInterval)
    defer.setInterval(function * () {
      yield this.reloadLocalRoutes()
      yield this.broadcast()
    }.bind(this), this.routeBroadcastInterval)
  }

  broadcast () {
    const routes = this.routingTables.toJSON(SIMPLIFY_POINTS)
    return Promise.all(
      Object.keys(this.adjacentConnectors).map(
        (adjacentConnector) => this._broadcastTo(adjacentConnector, routes)))
  }

  _broadcastTo (adjacentConnector, routes) {
    return request({
      method: 'POST',
      uri: adjacentConnector + '/routes',
      body: routes,
      json: true
    }).then((res) => {
      if (res.statusCode !== 200) {
        throw new Error('Unexpected status code: ' + res.statusCode)
      }
    })
  }

  crawlLedgers () {
    return this.core.getClients().map(this._crawlLedger, this)
  }

  * _crawlLedger (client) {
    const connectors = yield client.getConnectors()
    connectors.forEach(this.addConnector, this)
  }

  * reloadLocalRoutes () {
    const localRoutes = yield this._getLocalRoutes()
    yield this.routingTables.addLocalRoutes(this.infoCache, localRoutes)
  }

  /**
   * @param {URI} connector
   */
  addConnector (connector) {
    // Don't broadcast routes to ourselves.
    if (connector === this.baseURI) return
    this.adjacentConnectors[connector] = true
  }

  _getLocalRoutes () {
    return Promise.all(this.tradingPairs.map(
      (pair) => this._tradingPairToLocalRoute(pair)))
  }

  _tradingPairToLocalRoute (pair) {
    const sourceLedger = pair[0].split('@')[1]
    const destinationLedger = pair[1].split('@')[1]
    // TODO change the backend API to return curves, not points
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
    return Route.fromData({
      source_ledger: quote.source_ledger,
      destination_ledger: quote.destination_ledger,
      additional_info: quote.additional_info,
      connector: this.baseURI,
      min_message_window: this.minMessageWindow,
      source_account: (yield sourcePlugin.getAccount()),
      destination_account: (yield destinationPlugin.getAccount()),
      points: [
        [0, 0],
        [+quote.source_amount, +quote.destination_amount]
      ]
    })
  }
}

module.exports = RouteBroadcaster
