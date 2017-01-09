'use strict'

const log = require('../../src/common').log

const loadConfig = require('../../src/lib/config')
const RoutingTables = require('../../src/lib/routing-tables')
const RouteBuilder = require('../../src/lib/route-builder')
const RouteBroadcaster = require('../../src/lib/route-broadcaster')
const Ledgers = require('../../src/lib/ledgers')
const BalanceCache = require('../../src/lib/balance-cache')
const TradingPairs = require('../../src/lib/trading-pairs')
const MessageRouter = require('../../src/lib/message-router')

const createApp = require('../../src').createApp

exports.create = function (context) {
  // Set up test environment
  if (!process.env.CONNECTOR_LEDGERS) {
    process.env.CONNECTOR_LEDGERS = JSON.stringify(require('../data/ledgerCredentials.json'))
  }
  if (!process.env.CONNECTOR_PAIRS) {
    process.env.CONNECTOR_PAIRS = JSON.stringify(require('../data/tradingPairs.json'))
  }
  process.env.CONNECTOR_DEBUG_REPLY_NOTIFICATIONS = 'true'

  const config = loadConfig()
  const tradingPairs = new TradingPairs(config.get('tradingPairs'))
  const Backend = require('../../src/backends/' + config.get('backend'))
  const backend = new Backend({
    currencyWithLedgerPairs: tradingPairs,
    backendUri: config.get('backendUri'),
    spread: config.get('fxSpread')
  })
  const routingTables = new RoutingTables({
    backend: config.backend,
    expiryDuration: config.routeExpiry,
    slippage: config.slippage,
    fxSpread: config.fxSpread
  })
  const ledgers = new Ledgers({config, log, routingTables})
  ledgers.addFromCredentialsConfig(config.get('ledgerCredentials'))
  ledgers.setPairs(config.get('tradingPairs'))
  const routeBuilder = new RouteBuilder(
    routingTables,
    ledgers,
    {
      minMessageWindow: config.expiry.minMessageWindow,
      slippage: config.slippage
    }
  )
  const routeBroadcaster = new RouteBroadcaster(routingTables, backend, ledgers, {
    minMessageWindow: config.expiry.minMessageWindow,
    routeCleanupInterval: config.routeCleanupInterval,
    routeBroadcastInterval: config.routeBroadcastInterval,
    autoloadPeers: true,
    peers: [],
    ledgerCredentials: config.ledgerCredentials,
    configRoutes: config.configRoutes
  })
  const balanceCache = new BalanceCache(ledgers)
  const messageRouter = new MessageRouter({config, ledgers, routingTables, routeBroadcaster, routeBuilder, balanceCache})
  const app = createApp(config, ledgers, backend, routeBuilder, routeBroadcaster, routingTables, tradingPairs, balanceCache, messageRouter)
  context.app = app
  context.backend = backend
  context.tradingPairs = tradingPairs
  context.routingTables = routingTables
  context.routeBroadcaster = routeBroadcaster
  context.routeBuilder = routeBuilder
  context.ledgers = ledgers
  context.config = config
  context.balanceCache = balanceCache
  context.messageRouter = messageRouter
}
