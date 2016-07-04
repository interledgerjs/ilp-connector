'use strict'
const createApp = require('./app')

const connector = createApp()

module.exports = {
  app: connector.koaApp,
  createApp: createApp,
  listen: connector.listen,
  _test: {
    BalanceCache: require('./lib/balance-cache'),
    balanceCache: require('./services/balance-cache'),
    RouteBroadcaster: require('./lib/route-broadcaster'),
    RouteBuilder: require('./lib/route-builder'),
    loadConnectorConfig: require('./lib/config'),
    config: require('./services/config'),
    logger: require('./common').log,
    backend: require('./services/backend'),
    infoCache: require('./services/info-cache')
  }
}

if (!module.parent) {
  connector.listen()
}
