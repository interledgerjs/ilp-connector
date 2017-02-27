'use strict'

const _ = require('lodash')
const co = require('co')
const defer = require('co-defer')
const fetch = require('node-fetch')
const debug = require('debug')('ilp-connector:integration-test-client')
const log = require('../common').log.create('integration-test-client')

class IntegrationTestClient {
  /**
   * @param {Object} config
   * @param {Ledgers} ledgers
   * @param {Backend} backend

   */
  constructor (config, ledgers, backend, routeBuilder, routeBroadcaster, messageRouter) {
    this.uri = config.integrationTestUri
    this.name = config.integrationTestName
    this.messageLog = []
    this.routeBroadcastInterval = config.routeBroadcastInterval
    this.config = config
    this.ledgers = ledgers
    this.backend = backend
    this.routeBuilder = routeBuilder
    this.routeBroadcaster = routeBroadcaster
    this.messageRouter = messageRouter
  }

  start () {
    try {
      this.sendInit()
    } catch (e) {
      if (e.name === 'SystemError' ||
          e.name === 'ServerError') {
        // System error, in that context that is a network error
        // This will be retried later, so do nothing
      } else {
        throw e
      }
    }
    this.sendRouteUpdateSoon()
  }

  sendInit () {
    const itc = this // what's the proper way of dealing with this being shadowed?
    co(function * () {
      debug('sendInit uri:', this.uri)
      const payload =
        { port: itc.config.integrationTestPort,
          config_routes: itc.config.configRoutes,
          ledger_credentials: itc.config.ledgerCredentials,
          broadcast_interval: itc.config.routeBroadcastInterval,
          route_expiry: itc.config.routeExpiry }
      const body =
        { message: 'connector_hello',
          name: itc.name,
          data: payload}

      const res = yield fetch(itc.uri, {method: 'POST', body: JSON.stringify(body)})
      const text = yield res.text()
      debug('sendInit res.text:', text)
    }).catch((err) => log.error(err))
  }

  sendRouteStableMessage () {
    const itc = this
    co(function * () {
      const body = {name: itc.name, message: 'routing_table_stabilized', data: itc.lastRoutes}
      const res = yield fetch(itc.uri, { method: 'POST', body: JSON.stringify(body) })
      const text = yield res.text()
      debug('sendRouteStableMessage res.text:', text)
    }).catch((err) => log.error(err))
  }

  sendRouteUpdateSoon () {
    debug('sendRouteUpdateSoon routeBroadcastInterval:', this.routeBroadcastInterval)
    defer.setTimeout(function * () {
      try {
        const routes = this.routeBroadcaster.routingTables.toJSON(1000) // todo: get # of points from somewhere?
        const broadcastingEpoch = this.routeBroadcaster._currentEpoch()
        const lastNewRouteSentAt = this.routeBroadcaster.lastNewRouteSentAt
        const mostPoints = _.reduce(routes, (maxPoints, route) => Math.max(route.points.length, maxPoints), 0)
        const lastEpoch = _.reduce(routes, (latestEpoch, route) => Math.max(route.added_during_epoch, latestEpoch), 0)
        debug('sendRouteUpdateSoon broadcastingEpoch:', broadcastingEpoch, ' lastNewRouteSentAt:', lastNewRouteSentAt, ' mostPoints:', mostPoints, 'lastEpoch:', lastEpoch)
        if (this.lastRoutes) {
          // todo: better test?
          if (this.lastRoutes.length === routes.length &&
              _.every(routes, (r, i) => r.points.length === this.lastRoutes[i].points.length)) {
            debug('sendRouteUpdateSoon routes matches lastRoutes')
            if (this.roundsStable >= 3) {
              this.sendRouteStableMessage()
              this.roundsStable = -Infinity
            } else {
              this.roundsStable++
            }
          } else {
            this.roundsStable = 0
            this.lastRoutes = routes
          }
        } else {
          this.lastRoutes = routes
          this.roundsStable = 0
        }
      } catch (err) {
        log.warn('sendRouteUpdateSoon failed - backend:', this.backend)
        log.warn(err)
      }
      this.sendRouteUpdateSoon()
      // this needs to run on the same interval as route-broadcast in order for a simple roundsStable check to make sense
    }.bind(this), this.routeBroadcastInterval)
  }

  messageReceived (message, sender) {
    if (message.method === 'broadcast_routes') {
      debug(this.name + ' receiveRoutes from: ' + sender + ' routes:' + JSON.stringify(message.data))
      this.messageLog.push({message: message, sender: sender})
      if (message.data.new_routes.length > 0) {
        this.lastNewRouteReceivedAt = Date.now()
      }
    }
  }
}

module.exports = IntegrationTestClient
