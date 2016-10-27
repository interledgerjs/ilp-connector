'use strict'
const createApp = require('./app')

const connector = createApp()

module.exports = {
  createApp: createApp,
  addPlugin: connector.addPlugin,
  removePlugin: connector.removePlugin,
  listen: connector.listen,
  _test: {
    BalanceCache: require('./lib/balance-cache'),
    RouteBroadcaster: require('./lib/route-broadcaster'),
    RouteBuilder: require('./lib/route-builder'),
    loadConnectorConfig: require('./lib/config'),
    logger: require('./common').log
  }
}

if (!module.parent) {
  connector.listen()
}
