'use strict'

const RoutingTables = require('../lib/routing-tables')
const config = require('./config')

module.exports = new RoutingTables(
  config.server.base_uri,
  config.routeExpiry)
