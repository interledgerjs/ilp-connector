'use strict'

const defer = require('co-defer')
const _ = require('lodash')
const request = require('co-request')
const BROADCAST_INTERVAL = 30 * 1000 // milliseconds

class RouteBroadcaster {
  constructor (baseURI, pairs, tables) {
    this.baseURI = baseURI
    this.tables = tables
    this.adjacentConnectors = {}
    this.adjacentLedgers = {}
    for (const pair of pairs) {
      this.adjacentLedgers[pair[0]] = true
      this.adjacentLedgers[pair[1]] = true
    }
  }

  * start () {
    yield this.crawlLedgers()
    setInterval(() => this.tables.removeExpiredRoutes(), 1000)
    defer.setInterval(this.broadcast.bind(this), BROADCAST_INTERVAL)
  }

  broadcast () {
    const routes = this.tables.toJSON()
    return Promise.all(
      Object.keys(this.adjacentConnectors).map(function (adjacentConnector) {
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
      }))
  }

  crawlLedgers () {
    return Object.keys(this.adjacentLedgers).map(this.crawlLedger, this)
  }

  * crawlLedger (ledger) {
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
}

module.exports = RouteBroadcaster
