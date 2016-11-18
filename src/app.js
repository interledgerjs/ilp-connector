'use strict'

const _ = require('lodash')
const co = require('co')
const subscriptions = require('./models/subscriptions')
const ilpCore = require('ilp-core')
const logger = require('./common/log')
const log = logger.create('app')

const loadConfig = require('./lib/config')
const makeCore = require('./lib/core')
const RoutingTables = require('./lib/routing-tables')
const TradingPairs = require('./lib/trading-pairs')
const RouteBuilder = require('./lib/route-builder')
const RouteBroadcaster = require('./lib/route-broadcaster')
const InfoCache = require('./lib/info-cache')
const BalanceCache = require('./lib/balance-cache')
const MessageRouter = require('./lib/message-router')

function listen (config, core, backend, routeBuilder, routeBroadcaster, messageRouter, tradingPairs) {
  for (let pair of tradingPairs.toArray()) {
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
    yield subscriptions.subscribePairs(tradingPairs.toArray(), core, config, routeBuilder, messageRouter)
    if (config.routeBroadcastEnabled) {
      yield routeBroadcaster.start()
    } else {
      yield routeBroadcaster.addConfigRoutes()
      yield routeBroadcaster.reloadLocalRoutes()
    }
    log.info('connector ready (republic attitude)')
  }).catch((err) => log.error(err))
}

function addPlugin (config, core, backend, routeBroadcaster, tradingPairs, id, options, tradesTo, tradesFrom) {
  return co(function * () {
    core.addClient(id, new ilpCore.Client(Object.assign({}, options.options, {
      _plugin: require(options.plugin),
      _log: logger.createRaw(options.plugin)
    })))

    yield core.getClient(id).connect()

    if (tradesTo) {
      tradingPairs.addPairs(tradesTo.map((e) => [options.currency + '@' + id, e]))
    }

    if (tradesFrom) {
      tradingPairs.addPairs(tradesTo.map((e) => [e, options.currency + '@' + id]))
    }

    if (!tradesFrom && !tradesTo) {
      tradingPairs.addAll(options.currency + '@' + id)
    }

    yield routeBroadcaster.reloadLocalRoutes()
  })
}

function removePlugin (config, core, backend, routingTables, tradingPairs, id) {
  return co(function * () {
    tradingPairs.removeAll(id)
    routingTables.removeLedger(id)
    yield core.removeClient(id).disconnect()
  })
}

function createApp (config, core, backend, routeBuilder, routeBroadcaster, routingTables, tradingPairs, infoCache, balanceCache, messageRouter) {
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

  if (!core) {
    core = makeCore({config, log: logger, routingTables})
  }

  if (!tradingPairs) {
    tradingPairs = new TradingPairs(config.get('tradingPairs'))
  }

  if (!backend) {
    const Backend = getBackend(config.get('backend'))
    backend = new Backend({
      currencyWithLedgerPairs: tradingPairs,
      backendUri: config.get('backendUri'),
      spread: config.get('fxSpread'),
      infoCache: infoCache
    })
  }

  if (!infoCache) {
    infoCache = new InfoCache(core)
  }

  if (!routeBuilder) {
    routeBuilder = new RouteBuilder(
      routingTables,
      infoCache,
      core,
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
      core,
      infoCache,
      {
        tradingPairs: tradingPairs,
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
    balanceCache = new BalanceCache(core)
  }

  if (!messageRouter) {
    messageRouter = new MessageRouter({
      config,
      core,
      routingTables,
      routeBroadcaster,
      routeBuilder,
      balanceCache
    })
  }

  return {
    listen: _.partial(listen, config, core, backend, routeBuilder, routeBroadcaster, messageRouter, tradingPairs),
    addPlugin: _.partial(addPlugin, config, core, backend, routeBroadcaster, tradingPairs),
    removePlugin: _.partial(removePlugin, config, core, backend, routingTables, tradingPairs)
  }
}

function getBackend (backend) {
  try {
    return require('./backends/' + backend)
  } catch (err) {
    try {
      return require(backend)
    } catch (err) {
      throw new Error('Backend not found at "' + backend + '" or "/backends/' + backend + '"')
    }
  }
}

module.exports = createApp
