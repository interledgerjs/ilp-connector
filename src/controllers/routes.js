'use strict'

const requestUtil = require('five-bells-shared/utils/request')
const routing = require('five-bells-routing')
const config = require('../services/config')
const routingTables = require('../services/routing-tables')
const routeBroadcaster = require('../services/route-broadcaster')
const knownConnectors = {}

exports.post = function * () {
  const routes = yield requestUtil.validateBody(this, 'Routes')

  for (const route of routes) {
    routingTables.addRoute(
      route.source_ledger,
      route.destination_ledger,
      route.connector,
      new routing.Route(route.points))
  }

  const connector = routes[0] && routes[0].connector
  if (config.features.broadcastRoutes && connector && !knownConnectors[connector]) {
    yield routeBroadcaster.broadcast()
    knownConnectors[connector] = true
  }

  this.status = 200
}
