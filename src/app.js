'use strict'

const _ = require('lodash')
const co = require('co')
const subscriptions = require('./models/subscriptions')
const logger = require('./common/log')
const log = logger.create('app')

const loadConfig = require('./lib/config')
const RoutingTables = require('./lib/routing-tables')
const RouteBuilder = require('./lib/route-builder')
const RouteBroadcaster = require('./lib/route-broadcaster')
const Ledgers = require('./lib/ledgers')
const BalanceCache = require('./lib/balance-cache')
const MessageRouter = require('./lib/message-router')

function listen (config, ledgers, backend, routeBuilder, routeBroadcaster, messageRouter) {
  for (let pair of ledgers.getPairs()) {
    log.info('pair', pair)
  }

  // Start a coroutine that connects to the backend and
  // subscribes to all the ledgers in the background
  co(function * () {
    try {
      yield backend.connect()
    } catch (error) {
      log.error(error)
      process.exit(1)
    }
    yield subscriptions.subscribePairs(ledgers.getCore(), config, routeBuilder, messageRouter, backend)
    yield ledgers.connect({timeout: Infinity})
    if (config.routeBroadcastEnabled) {
      yield routeBroadcaster.start()
    } else {
      yield routeBroadcaster.addConfigRoutes()
      yield routeBroadcaster.reloadLocalRoutes()
    }
    log.info('connector ready (republic attitude)')
  }).catch((err) => log.error(err))
}

function addPlugin (config, ledgers, backend, routeBroadcaster, id, options, tradesTo, tradesFrom) {
  return co(function * () {
    options.prefix = id
    ledgers.add(id, options, tradesTo, tradesFrom)

    yield ledgers.getPlugin(id).connect({timeout: Infinity})

    yield routeBroadcaster.reloadLocalRoutes()
    yield routeBroadcaster._crawlLedgerPlugin(ledgers.getPlugin(id))
  })
}

function removePlugin (config, ledgers, backend, routingTables, routeBroadcaster, id) {
  return co(function * () {
    routingTables.removeLedger(id)
    routeBroadcaster.depeerLedger(id)
    yield ledgers.remove(id).disconnect()
  })
}

function getPlugin (ledgers, id) {
  return ledgers.getPlugin(id)
}

function createApp (config, ledgers, backend, routeBuilder, routeBroadcaster, routingTables, balanceCache, messageRouter) {
  if (!config) {
    config = loadConfig()
  }

  if (!routingTables) {
    routingTables = new RoutingTables({
      backend: config.backend,
      expiryDuration: config.routeExpiry,
      fxSpread: config.fxSpread,
      slippage: config.slippage
    })
  }

  if (!ledgers) {
    ledgers = new Ledgers({config, log: logger, routingTables})
    ledgers.addFromCredentialsConfig(config.get('ledgerCredentials'))
    ledgers.setPairs(config.get('tradingPairs'))
  }

  if (!backend) {
    const Backend = getBackend(config.get('backend'))
    backend = new Backend({
      currencyWithLedgerPairs: ledgers.getPairs(),
      backendUri: config.get('backendUri'),
      spread: config.get('fxSpread'),
      getInfo: (ledger) => ledgers.getPlugin(ledger).getInfo()
    })
  }

  if (!routeBuilder) {
    routeBuilder = new RouteBuilder(
      routingTables,
      ledgers,
      {
        minMessageWindow: config.expiry.minMessageWindow,
        slippage: config.slippage
      }
    )
  }

  if (!routeBroadcaster) {
    routeBroadcaster = new RouteBroadcaster(
      routingTables,
      backend,
      ledgers,
      {
        configRoutes: config.configRoutes,
        minMessageWindow: config.expiry.minMessageWindow,
        routeCleanupInterval: config.routeCleanupInterval,
        routeBroadcastInterval: config.routeBroadcastInterval,
        autoloadPeers: config.autoloadPeers,
        peers: config.peers,
        ledgerCredentials: config.ledgerCredentials
      }
    )
  }

  if (!balanceCache) {
    balanceCache = new BalanceCache(ledgers)
  }

  if (!messageRouter) {
    messageRouter = new MessageRouter({
      config,
      ledgers,
      routingTables,
      routeBroadcaster,
      routeBuilder,
      balanceCache
    })
  }

  return {
    getClient: ledgers.getClient.bind(ledgers),
    listen: _.partial(listen, config, ledgers, backend, routeBuilder, routeBroadcaster, messageRouter),
    addPlugin: _.partial(addPlugin, config, ledgers, backend, routeBroadcaster),
    removePlugin: _.partial(removePlugin, config, ledgers, backend, routingTables, routeBroadcaster),
    getPlugin: _.partial(getPlugin, ledgers)
  }
}

function getBackend (backend) {
  if (moduleExists('./backends/' + backend)) return require('./backends/' + backend)
  if (moduleExists(backend)) return require(backend)
  throw new Error('Backend not found at "' + backend + '" or "/backends/' + backend + '"')
}

function moduleExists (path) {
  try {
    require.resolve(path)
    return true
  } catch (err) {
    return false
  }
}

module.exports = createApp
