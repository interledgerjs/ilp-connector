'use strict'

const RoutingTables = require('../lib/routing-tables')
const config = require('./config')

module.exports = new RoutingTables({
  baseURI: config.server.base_uri,
  backend: config.backend,
  expiryDuration: config.routeExpiry,
  fxSpread: config.fxSpread,
  slippage: config.slippage
})
