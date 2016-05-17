'use strict'

const co = require('co')
const defer = require('co-defer')
const _ = require('lodash')
const request = require('co-request')

class RouteBroadcaster {
  /**
   * @param {RoutingTables} routingTables
   * @param {Backend} backend
   * @param {Object} config
   * @param {Object} config.ledgerCredentials
   * @param {Object} config.tradingPairs
   * @param {Number} config.minMessageWindow
   * @param {Number} config.routeCleanupInterval
   * @param {Number} config.routeBroadcastInterval
   */
  constructor (routingTables, backend, config) {
    this.routeCleanupInterval = config.routeCleanupInterval
    this.routeBroadcastInterval = config.routeBroadcastInterval
    this.baseURI = routingTables.baseURI
    this.routingTables = routingTables
    this.backend = backend
    this.ledgerCredentials = config.ledgerCredentials
    this.tradingPairs = config.tradingPairs
    this.minMessageWindow = config.minMessageWindow
    this.adjacentConnectors = {}
    this.adjacentLedgers = {}
    for (const pair of config.tradingPairs) {
      const destinationLedger = pair[1].split('@')[1]
      this.adjacentLedgers[destinationLedger] = true
    }
  }

  * start () {
    yield this.crawlLedgers()
    try {
      yield this.reloadLocalRoutes()
      yield this.broadcast()
    } catch (e) {
      if (e.name === 'SystemError') {
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
    const routes = this.routingTables.toJSON()
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
    return Object.keys(this.adjacentLedgers).map(this._crawlLedger, this)
  }

  * _crawlLedger (ledger) {
    const res = yield request({
      method: 'GET',
      uri: ledger + '/connectors',
      json: true
    })
    if (res.statusCode !== 200) {
      throw new Error('Unexpected status code: ' + res.statusCode)
    }
    const connectors = _.map(res.body, 'connector')
    for (const connector of connectors) {
      // Don't broadcast routes to ourselves.
      if (connector === this.baseURI) continue
      this.adjacentConnectors[connector] = true
    }
  }

  /**
   * @returns {Promise}
   */
  reloadLocalRoutes () {
    return this._getLocalRoutes().then(
      (routes) => this.routingTables.addLocalRoutes(routes))
  }

  _getLocalRoutes () {
    return Promise.all(this.tradingPairs.map((pair) => {
      return this._tradingPairToQuote(pair)
        .then((quote) => this._quoteToLocalRoute(quote))
    }))
  }

  _tradingPairToQuote (pair) {
    const sourceLedger = pair[0].split('@')[1]
    const destinationLedger = pair[1].split('@')[1]
    // TODO change the backend API to return curves, not points
    return co(this.backend.getQuote.bind(this.backend), {
      source_ledger: sourceLedger,
      destination_ledger: destinationLedger,
      source_amount: 100000000
    })
  }

  _quoteToLocalRoute (quote) {
    return {
      source_ledger: quote.source_ledger,
      destination_ledger: quote.destination_ledger,
      connector: this.baseURI,
      min_message_window: this.minMessageWindow,
      source_account: this.ledgerCredentials[quote.source_ledger].account_uri,
      destination_account: this.ledgerCredentials[quote.destination_ledger].account_uri,
      points: [
        [0, 0],
        [+quote.source_amount, +quote.destination_amount]
      ]
    }
  }
}

module.exports = RouteBroadcaster
