'use strict'
const ledgers = require('./services/ledgers')
const config = require('./services/config')
const balanceCache = require('./services/balance-cache')
const createApp = require('./app')
const precisionCache = require('./services/precision-cache')

const connector = createApp(config, ledgers)

module.exports = {
  app: connector.koaApp,
  createApp: createApp,
  listen: connector.listen,
  addLedger: ledgers.addLedger.bind(ledgers),
  _test: {
    BalanceCache: require('./lib/balance-cache'),
    balanceCache: balanceCache,
    loadConnectorConfig: require('./lib/config'),
    config: require('./services/config'),
    logger: require('./common').log,
    backend: require('./services/backend'),
    precisionCache: precisionCache
  }
}

if (!module.parent) {
  connector.listen()
}
