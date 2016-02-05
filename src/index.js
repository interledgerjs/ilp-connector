'use strict'
const co = require('co')
const ledgers = require('./services/ledgers')
const config = require('./services/config')
const log = require('./services/log')
const backend = require('./services/backend')
const subscriber = require('./services/subscriber')
const app = require('./app')

function listen () {
  app.listen(config.getIn(['server', 'port']))

  log('app').info('connector listening on ' + config.getIn(['server', 'bind_ip']) + ':' +
    config.getIn(['server', 'port']))
  log('app').info('public at ' + config.getIn(['server', 'base_uri']))
  for (let pair of config.get('tradingPairs')) {
    log('app').info('pair', pair)
  }

  // Start a coroutine that connects to the backend and
  // subscribes to all the ledgers in the background
  co(function * () {
    yield backend.connect()

    yield subscriber.subscribePairs(config.get('tradingPairs'))
  }).catch(function (err) {
    log('app').error(typeof err === 'object' && err.stack || err)
  })
}

module.exports = {
  app: app,
  listen: listen,
  addLedger: ledgers.addLedger.bind(ledgers),
  _test: {
    BalanceCache: require('./lib/balance-cache'),
    balanceCache: require('./services/balance-cache'),
    loadConnectorConfig: require('./lib/config'),
    config: require('./services/config'),
    logger: require('./services/log'),
    backend: require('./services/backend')
  }
}

if (!module.parent) {
  listen()
}
