'use strict'

const _ = require('lodash')
const logger = require('./common/log')
const log = logger.create('app')

const Config = require('./lib/config')
const PrefixMap = require('./routing/prefix-map')
const Quoter = require('./lib/quoter')
const RouteBuilder = require('./lib/route-builder')
const RouteBroadcaster = require('./lib/route-broadcaster')
const Accounts = require('./lib/accounts')
const MessageRouter = require('./lib/message-router')
const payments = require('./models/payments')

function listen (config, accounts, backend, routeBuilder, routeBroadcaster, messageRouter) {
  // Start a coroutine that connects to the backend and
  // subscribes to all the accounts in the background
  return (async function () {
    config.validate()

    try {
      await backend.connect()
    } catch (error) {
      log.error(error)
      process.exit(1)
    }

    let allAccountsConnected
    try {
      await accounts.connect({timeout: 10000})
      allAccountsConnected = true
    } catch (err) {
      allAccountsConnected = false
      log.warn('one or more accounts failed to connect; broadcasting routes anyway; error=', err.message)
    }

    if (config.routeBroadcastEnabled) {
      await routeBroadcaster.start()
    }

    if (allAccountsConnected) {
      log.info('connector ready (republic attitude)')
    } else {
      accounts.connect({timeout: Infinity})
        .then(() => routeBroadcaster.reloadLocalRoutes())
        .then(() => log.info('connector ready (republic attitude)'))
    }
  })().catch((err) => log.error(err))
}

function addPlugin (config, accounts, backend, routeBroadcaster, id, options, tradesTo, tradesFrom) {
  return (async function () {
    options.prefix = id
    accounts.add(id, options, tradesTo, tradesFrom)
    routeBroadcaster.add(id)

    await accounts.getPlugin(id).connect({timeout: Infinity})
    await routeBroadcaster.reloadLocalRoutes()
  })()
}

function removePlugin (config, accounts, backend, routeBroadcaster, id) {
  return (async function () {
    await accounts.remove(id).disconnect()
    routeBroadcaster.remove(id)
    routeBroadcaster.reloadLocalRoutes()
  })()
}

function getPlugin (accounts, id) {
  return accounts.getPlugin(id)
}

function registerRequestHandler (accounts, fn) {
  return accounts.registerExternalRequestHandler(fn)
}

function createApp ({ config, accounts, backend, routeBuilder, quoter, routeBroadcaster, routingTable, messageRouter } = {}) {
  if (!config) {
    config = new Config()
  }

  if (!routingTable) {
    routingTable = new PrefixMap()
  }

  if (!accounts) {
    accounts = new Accounts({config, log: logger, routingTable})
    accounts.setPairs(config.get('tradingPairs'))
  }

  if (!quoter) {
    quoter = new Quoter(accounts, config)
  }

  if (!backend) {
    const Backend = getBackend(config.get('backend'))
    backend = new Backend({
      currencyWithLedgerPairs: accounts.getPairs(),
      backendUri: config.get('backendUri'),
      spread: config.get('fxSpread'),
      getInfo: (ledger) => accounts.getPlugin(ledger).getInfo()
    })
  }

  if (!routeBuilder) {
    routeBuilder = new RouteBuilder(
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
  }

  if (!routeBroadcaster) {
    routeBroadcaster = new RouteBroadcaster(
      routingTable,
      backend,
      accounts,
      quoter,
      {
        address: config.address,
        routes: config.routes,
        minMessageWindow: config.expiry.minMessageWindow,
        routeCleanupInterval: config.routeCleanupInterval,
        routeBroadcastInterval: config.routeBroadcastInterval,
        routeExpiry: config.routeExpiry,
        broadcastCurves: config.broadcastCurves,
        peers: config.peers,
        accountCredentials: config.accountCredentials
      }
    )
  }

  if (!messageRouter) {
    messageRouter = new MessageRouter({
      config,
      accounts,
      routeBroadcaster,
      routeBuilder
    })
  }

  accounts.registerTransferHandler(
    payments.handleIncomingTransfer.bind(payments, accounts, config, routeBuilder, backend)
  )

  const credentials = config.get('accountCredentials')
  // We have two separate for loops to make the logs look nicer :)
  for (let address of Object.keys(credentials)) {
    accounts.add(address, credentials[address])
  }
  for (let address of Object.keys(credentials)) {
    routeBroadcaster.add(address)
  }

  return {
    listen: _.partial(listen, config, accounts, backend, routeBuilder, routeBroadcaster, messageRouter),
    addPlugin: _.partial(addPlugin, config, accounts, backend, routeBroadcaster),
    removePlugin: _.partial(removePlugin, config, accounts, backend, routeBroadcaster),
    getPlugin: _.partial(getPlugin, accounts),
    registerRequestHandler: _.partial(registerRequestHandler, accounts)
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
