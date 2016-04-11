'use strict'

const RouteBroadcaster = require('../lib/route-broadcaster')
const config = require('./config')

module.exports = new RouteBroadcaster(
  config.server.base_uri,
  config.tradingPairs,
  require('./routing-tables'))
