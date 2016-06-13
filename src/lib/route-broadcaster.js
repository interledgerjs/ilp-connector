'use strict'

const _ = require('lodash')
const co = require('co')
const defer = require('co-defer')
const request = require('co-request')
const Route = require('five-bells-routing').Route
const SIMPLIFY_POINTS = 10

class RouteBroadcaster {
  /**
   * @param {RoutingTables} routingTables
   * @param {Backend} backend
   * @param {Multiledger} ledgers
   * @param {InfoCache} infoCache
   * @param {Object} config
   * @param {Object} config.tradingPairs
   * @param {Number} config.minMessageWindow
   * @param {Number} config.routeCleanupInterval
   * @param {Number} config.routeBroadcastInterval
   */
  constructor (routingTables, backend, ledgers, infoCache, config) {
    this.routeCleanupInterval = config.routeCleanupInterval
    this.routeBroadcastInterval = config.routeBroadcastInterval
    this.baseURI = routingTables.baseURI
    this.routingTables = routingTables
    this.backend = backend
    this.ledgers = ledgers
    this.infoCache = infoCache
    this.tradingPairs = config.tradingPairs
    this.minMessageWindow = config.minMessageWindow
    this.adjacentConnectors = {}
  }

  * start () {
    yield this.crawlLedgers()
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
    defer.setInterval(() => {
      return this.reloadLocalRoutes().then(this.broadcast.bind(this))
    }, this.routeBroadcastInterval)
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
    return _.values(this.ledgers.getLedgers()).map(this._crawlLedger, this)
  }

  * _crawlLedger (ledger) {
    const connectors = yield ledger.getConnectors()
    connectors.forEach(this.addConnector, this)
  }

  * reloadLocalRoutes () {
    const localRoutes = yield this._getLocalRoutes()
    this.routingTables.addLocalRoutes(localRoutes)
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
    return co(this.backend.getQuote.bind(this.backend), {
      source_ledger: sourceLedger,
      destination_ledger: destinationLedger,
      source_amount: 100000000
    }).then((quote) => this._quoteToLocalRoute(quote))
      .then((route) => co(this._shiftRoute.bind(this), route))
  }

  _quoteToLocalRoute (quote) {
    return Route.fromData({
      source_ledger: quote.source_ledger,
      destination_ledger: quote.destination_ledger,
      additional_info: quote.additional_info,
      connector: this.baseURI,
      min_message_window: this.minMessageWindow,
      source_account: this.ledgers.getLedger(quote.source_ledger).getAccount(),
      destination_account: this.ledgers.getLedger(quote.destination_ledger).getAccount(),
      points: [
        [0, 0],
        [+quote.source_amount, +quote.destination_amount]
      ]
    })
  }

  // Shift the graph down by a small amount so that precision rounding doesn't
  // cause UnacceptableRateErrors.
  * _shiftRoute (route) {
    const destinationAdjustment = yield this._getScaleAdjustment(route.destinationLedger)
    return route.shiftY(-destinationAdjustment)
  }

  * _getScaleAdjustment (ledger) {
    const scale = (yield this.infoCache.get(ledger)).scale
    return scale ? (1 / Math.pow(10, scale)) : 0
  }
}

module.exports = RouteBroadcaster
