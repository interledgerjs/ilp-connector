'use strict'

const config = require('./config')
const RouteBroadcaster = require('../lib/route-broadcaster')
module.exports = new RouteBroadcaster(
  require('./routing-tables'),
  require('./backend'),
  require('./ledgers'),
  require('./info-cache'),
  {
    tradingPairs: config.tradingPairs,
    minMessageWindow: config.expiry.minMessageWindow,
    routeCleanupInterval: config.routeCleanupInterval,
    routeBroadcastInterval: config.routeBroadcastInterval
  })
