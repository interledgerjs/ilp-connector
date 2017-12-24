'use strict'

const reduct = require('reduct')
const _ = require('lodash')
const logger = require('./common/log')
const log = logger.create('app')

const Config = require('./services/config')
const RouteBuilder = require('./services/route-builder')
const RouteBroadcaster = require('./services/route-broadcaster')
const Accounts = require('./services/accounts')
const RateBackend = require('./services/rate-backend')
const MessageRouter = require('./services/message-router')
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

function createApp (container) {
  const deps = container || reduct()

  const accounts = deps(Accounts)
  const config = deps(Config)
  const routeBuilder = deps(RouteBuilder)
  const routeBroadcaster = deps(RouteBroadcaster)
  const backend = deps(RateBackend)
  const messageRouter = deps(MessageRouter)

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

module.exports = createApp
