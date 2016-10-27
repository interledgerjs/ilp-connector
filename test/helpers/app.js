'use strict'

const log = require('../../src/common').log

const loadConfig = require('../../src/lib/config')
const InfoCache = require('../../src/lib/info-cache')
const RoutingTables = require('../../src/lib/routing-tables')
const RouteBuilder = require('../../src/lib/route-builder')
const RouteBroadcaster = require('../../src/lib/route-broadcaster')
const makeCore = require('../../src/lib/core')
const BalanceCache = require('../../src/lib/balance-cache')
const TradingPairs = require('../../src/lib/trading-pairs')
const MessageRouter = require('../../src/lib/message-router')

const createApp = require('ilp-connector').createApp

exports.create = function (context) {
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
  const core = makeCore({config, log, routingTables})
  const infoCache = new InfoCache(core)
  const routeBuilder = new RouteBuilder(
    routingTables,
    infoCache,
    core,
    {
      minMessageWindow: config.expiry.minMessageWindow,
      slippage: config.slippage
    }
  )
  const routeBroadcaster = new RouteBroadcaster(routingTables, backend, core, infoCache, {
    tradingPairs: tradingPairs,
    minMessageWindow: config.expiry.minMessageWindow,
    routeCleanupInterval: config.routeCleanupInterval,
    routeBroadcastInterval: config.routeBroadcastInterval,
    autoloadPeers: true,
    peers: [],
    ledgerCredentials: config.ledgerCredentials,
    configRoutes: config.configRoutes
  })
  const balanceCache = new BalanceCache(core)
  const messageRouter = new MessageRouter({config, core, routingTables, routeBroadcaster, routeBuilder, balanceCache})
  const app = createApp(config, core, backend, routeBuilder, routeBroadcaster, routingTables, tradingPairs, infoCache, balanceCache, messageRouter)
  context.app = app
  context.backend = backend
  context.tradingPairs = tradingPairs
  context.routingTables = routingTables
  context.routeBroadcaster = routeBroadcaster
  context.routeBuilder = routeBuilder
  context.core = core
  context.config = config
  context.infoCache = infoCache
  context.balanceCache = balanceCache
  context.messageRouter = messageRouter
}
