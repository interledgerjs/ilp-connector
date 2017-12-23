'use strict'

const loadConfig = require('../../src/lib/config')
const RouteBuilder = require('../../src/lib/route-builder')
const RouteBroadcaster = require('../../src/lib/route-broadcaster')
const PrefixMap = require('../../src/routing/prefix-map')
const Accounts = require('../../src/lib/accounts')
const Quoter = require('../../src/lib/quoter')
const TradingPairs = require('../../src/lib/trading-pairs')
const MessageRouter = require('../../src/lib/message-router')

const createApp = require('../../src').createApp

exports.create = function (context, minBalance) {
  process.env.CONNECTOR_ILP_ADDRESS = 'test.connie'

  // Set up test environment
  if (!process.env.CONNECTOR_ACCOUNTS) {
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify(require('../data/accountCredentials.json'))
  }
  if (!process.env.CONNECTOR_PAIRS) {
    process.env.CONNECTOR_PAIRS = JSON.stringify(require('../data/tradingPairs.json'))
  }
  process.env.CONNECTOR_DEBUG_REPLY_NOTIFICATIONS = 'true'

  process.env.CONNECTOR_SECRET = 'VafuntVJRw6YzDTs4IgIU1IPJACywtgUUQJHh1u018w='

  const config = loadConfig()
  const routingTable = new PrefixMap()
  const tradingPairs = new TradingPairs(config.get('tradingPairs'))
  const accounts = new Accounts({config, routingTable})
  const quoter = new Quoter(accounts, config)
  const Backend = require('../../src/backends/' + config.get('backend'))
  const backend = new Backend({
    currencyWithLedgerPairs: tradingPairs,
    backendUri: config.get('backendUri'),
    spread: config.get('fxSpread'),
    getInfo: (ledger) => {
      const info = accounts.getPlugin(ledger).getInfo()
      info.minBalance = minBalance
      return info
    },
    getCurrency: (ledger) => {
      return accounts.getCurrency(ledger)
    }
  })
  accounts.setPairs(config.get('tradingPairs'))
  const routeBuilder = new RouteBuilder(
    accounts,
    routingTable,
    backend,
    quoter,
    {
      minMessageWindow: config.expiry.minMessageWindow,
      maxHoldTime: config.expiry.maxHoldTime,
      slippage: config.slippage,
      secret: config.secret,
      address: config.address,
      quoteExpiry: config.quoteExpiry,
      reflectPayments: config.reflectPayments
    }
  )
  const routeBroadcaster = new RouteBroadcaster(routingTable, backend, accounts, quoter, {
    address: config.address,
    minMessageWindow: config.expiry.minMessageWindow,
    routeCleanupInterval: config.routeCleanupInterval,
    routeBroadcastInterval: config.routeBroadcastInterval,
    routeExpiry: config.routeExpiry,
    broadcastCurves: true,
    storeCurves: true,
    peers: config.peers,
    accountCredentials: config.accountCredentials,
    routes: config.routes
  })
  const messageRouter = new MessageRouter({config, accounts, routeBroadcaster, routeBuilder})
  const app = createApp({ config, accounts, backend, routeBuilder, routeBroadcaster, routingTable, tradingPairs, messageRouter })

  context.app = app
  context.backend = backend
  context.quoter = quoter
  context.routingTable = routingTable
  context.tradingPairs = tradingPairs
  context.routeBroadcaster = routeBroadcaster
  context.routeBuilder = routeBuilder
  context.accounts = accounts
  context.config = config
  context.messageRouter = messageRouter
}
