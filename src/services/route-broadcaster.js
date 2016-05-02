'use strict'

const config = require('./config')
const RouteBroadcaster = require('../lib/route-broadcaster')
module.exports = new RouteBroadcaster(
  require('./routing-tables'),
  require('./backend'),
  {
    ledgerCredentials: config.ledgerCredentials,
    tradingPairs: config.tradingPairs,
    minMessageWindow: config.expiry.minMessageWindow
  })
