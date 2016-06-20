'use strict'
const ledgers = require('./services/ledgers')
const config = require('./services/config')
const createApp = require('./app')

const connector = createApp(config, ledgers)

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
