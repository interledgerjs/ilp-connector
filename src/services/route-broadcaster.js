'use strict'

const config = require('./config')
const RouteBroadcaster = require('../lib/route-broadcaster')
module.exports = new RouteBroadcaster(
  require('./routing-tables'),
  require('./backend'),
  require('./core'),
  require('./info-cache'),
  {
    tradingPairs: require('./trading-pairs'),
    minMessageWindow: config.expiry.minMessageWindow,
    routeBroadcastEnabled: config.routeBroadcastEnabled,
    routeCleanupInterval: config.routeCleanupInterval,
    routeBroadcastInterval: config.routeBroadcastInterval,
    autoloadPeers: config.autoloadPeers,
    peers: config.peers
  })
