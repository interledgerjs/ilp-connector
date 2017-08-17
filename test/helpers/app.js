'use strict'

const log = require('../../src/common').log

const loadConfig = require('../../src/lib/config')
const RoutingTables = require('../../src/lib/routing-tables')
const RouteBuilder = require('../../src/lib/route-builder')
const RouteBroadcaster = require('../../src/lib/route-broadcaster')
const Quoter = require('../../src/lib/quoter')
const Ledgers = require('../../src/lib/ledgers')
const TradingPairs = require('../../src/lib/trading-pairs')
const MessageRouter = require('../../src/lib/message-router')

const createApp = require('../../src').createApp

exports.create = function (context, minBalance) {
  // Set up test environment
  if (!process.env.CONNECTOR_LEDGERS) {
    process.env.CONNECTOR_LEDGERS = JSON.stringify(require('../data/ledgerCredentials.json'))
  }
  if (!process.env.CONNECTOR_PAIRS) {
    process.env.CONNECTOR_PAIRS = JSON.stringify(require('../data/tradingPairs.json'))
  }
  process.env.CONNECTOR_DEBUG_REPLY_NOTIFICATIONS = 'true'

  process.env.CONNECTOR_SECRET = 'VafuntVJRw6YzDTs4IgIU1IPJACywtgUUQJHh1u018w='

  const config = loadConfig()
  const tradingPairs = new TradingPairs(config.get('tradingPairs'))
  const routingTables = new RoutingTables({
    backend: config.backend,
    expiryDuration: config.routeExpiry,
    slippage: config.slippage,
    fxSpread: config.fxSpread
  })
  const ledgers = new Ledgers({config, log, routingTables})
  const quoter = new Quoter(ledgers, {quoteExpiry: config.quoteExpiry})
  const Backend = require('../../src/backends/' + config.get('backend'))
  const backend = new Backend({
    currencyWithLedgerPairs: tradingPairs,
    backendUri: config.get('backendUri'),
    spread: config.get('fxSpread'),
    getInfo: (ledger) => {
      const info = ledgers.getPlugin(ledger).getInfo()
      info.minBalance = minBalance
      return info
    },
    getBalance: (ledger) => ledgers.getPlugin(ledger).getBalance()
  })
  ledgers.addFromCredentialsConfig(config.get('ledgerCredentials'))
  ledgers.setPairs(config.get('tradingPairs'))
  const routeBuilder = new RouteBuilder(
    ledgers,
    quoter,
    {
      minMessageWindow: config.expiry.minMessageWindow,
      maxHoldTime: config.expiry.maxHoldTime,
      slippage: config.slippage,
      secret: config.secret
    }
  )
  const routeBroadcaster = new RouteBroadcaster(routingTables, backend, ledgers, {
    minMessageWindow: config.expiry.minMessageWindow,
    routeCleanupInterval: config.routeCleanupInterval,
    routeBroadcastInterval: config.routeBroadcastInterval,
    routeExpiry: config.routeExpiry,
    broadcastCurves: true,
    storeCurves: true,
    autoloadPeers: true,
    peers: [],
    ledgerCredentials: config.ledgerCredentials,
    configRoutes: config.configRoutes
  })
  const messageRouter = new MessageRouter({config, ledgers, routingTables, routeBroadcaster, routeBuilder})
  const app = createApp(config, ledgers, backend, quoter, routeBuilder, routeBroadcaster, routingTables, tradingPairs, messageRouter)
  context.app = app
  context.backend = backend
  context.tradingPairs = tradingPairs
  context.routingTables = routingTables
  context.routeBroadcaster = routeBroadcaster
  context.routeBuilder = routeBuilder
  context.quoter = quoter
  context.ledgers = ledgers
  context.config = config
  context.messageRouter = messageRouter
}
