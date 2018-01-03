'use strict'

import reduct = require('reduct')
import { partial } from 'lodash'
import { create as createLogger } from './common/log'
const log = createLogger('app')

import Config from './services/config'
import RouteBuilder from './services/route-builder'
import RouteBroadcaster from './services/route-broadcaster'
import Accounts from './services/accounts'
import Balances from './services/balances'
import RateBackend from './services/rate-backend'
import Store from './services/store'
import MessageRouter from './services/message-router'

import { IPlugin } from './types/plugin'

function listen (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  store: Store,
  routeBuilder: RouteBuilder,
  routeBroadcaster: RouteBroadcaster,
  messageRouter: MessageRouter
) {
  // Start a coroutine that connects to the backend and
  // subscribes to all the accounts in the background
  return (async function () {
    try {
      await backend.connect()
    } catch (error) {
      log.error(error)
      process.exit(1)
    }

    let allAccountsConnected
    try {
      await accounts.connect({ timeout: 10000 })
      allAccountsConnected = true
    } catch (err) {
      allAccountsConnected = false
      log.warn('one or more accounts failed to connect, broadcasting routes anyway. error=', err.message)
    }

    if (config.routeBroadcastEnabled) {
      await routeBroadcaster.start()
    }

    if (allAccountsConnected) {
      log.info('connector ready (republic attitude). address=%s', config.ilpAddress)
    } else {
      accounts.connect({ timeout: Infinity })
        .then(() => routeBroadcaster.reloadLocalRoutes())
        .then(() => log.info('connector ready (republic attitude). address=%s', config.ilpAddress))
    }
  })().catch((err) => log.error(err))
}

function addPlugin (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  routeBroadcaster: RouteBroadcaster,

  id: string,
  options: any
) {
  return (async function () {
    accounts.add(id, options)
    routeBroadcaster.add(id)

    await accounts.getPlugin(id).connect({ timeout: Infinity })
    await routeBroadcaster.reloadLocalRoutes()
  })()
}

function removePlugin (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  routeBroadcaster: RouteBroadcaster,

  id: string
) {
  return (async function () {
    await accounts.getPlugin(id).disconnect()
    accounts.remove(id)
    routeBroadcaster.remove(id)
    routeBroadcaster.reloadLocalRoutes()
  })()
}

function getPlugin (
  accounts: Accounts,

  id: string
) {
  return accounts.getPlugin(id)
}

export default function createApp (opts?: object, container?: reduct.Injector) {
  const deps = container || reduct()

  const config = deps(Config)

  if (opts) {
    config.loadFromOpts(opts)
  } else {
    config.loadFromEnv()
  }

  try {
    config.validate()
  } catch (err) {
    if (err.name === 'InvalidJsonBodyError') {
      log.warn('config validation error.')
      err.debugPrint(log.warn)
      log.error('invalid configuration, shutting down.')
      throw new Error('failed to initialize due to invalid configuration.')
    }

    throw err
  }

  const accounts = deps(Accounts)
  const balances = deps(Balances)
  const routeBuilder = deps(RouteBuilder)
  const routeBroadcaster = deps(RouteBroadcaster)
  const backend = deps(RateBackend)
  const store = deps(Store)
  const messageRouter = deps(MessageRouter)

  accounts.registerDataHandler(
    messageRouter.handleData.bind(messageRouter)
  )

  accounts.registerMoneyHandler(
    balances.handleMoney.bind(balances)
  )

  const credentials = config.accounts
  // We have two separate for loops to make the logs look nicer :)
  for (let id of Object.keys(credentials)) {
    accounts.add(id, credentials[id])
  }
  for (let id of Object.keys(credentials)) {
    routeBroadcaster.add(id)
  }

  return {
    config,
    listen: partial(listen, config, accounts, backend, store, routeBuilder, routeBroadcaster, messageRouter),
    addPlugin: partial(addPlugin, config, accounts, backend, routeBroadcaster),
    removePlugin: partial(removePlugin, config, accounts, backend, routeBroadcaster),
    getPlugin: partial(getPlugin, accounts)
  }
}
