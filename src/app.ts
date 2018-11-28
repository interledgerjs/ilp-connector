import { default as reduct, Injector } from 'reduct'
import { partial } from 'lodash'
import { create as createLogger } from './common/log'
const log = createLogger('app')

import Config from './services/config'
import RouteBuilder from './services/route-builder'
import RouteBroadcaster from './services/route-broadcaster'
import Accounts from './services/accounts'
import RateBackend from './services/rate-backend'
import Store from './services/store'
import AdminApi from './services/admin-api'
import * as Prometheus from 'prom-client'
import { AccountService } from './types/account-service'
import { default as PluginAccountService } from './account-services/plugin'
import Core from './services/core'

function listen (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  store: Store,
  routeBuilder: RouteBuilder,
  routeBroadcaster: RouteBroadcaster,
  adminApi: AdminApi
) {
  // Start a coroutine that connects to the backend and
  // sets up the account manager that will start a grpc server to communicate with accounts
  return (async function () {
    adminApi.listen()

    try {
      await backend.connect()
    } catch (error) {
      log.error(error)
      process.exit(1)
    }

    await accounts.startup()

    if (config.collectDefaultMetrics) {
      Prometheus.collectDefaultMetrics()
    }

    log.info('connector ready (republic attitude). address=%s', accounts.getOwnAddress())
  })().catch((err) => log.error(err))
}

async function shutdown (
  accounts: Accounts,
  routeBroadcaster: RouteBroadcaster
) {
  routeBroadcaster.stop()
}

async function addPlugin (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  routeBroadcaster: RouteBroadcaster,

  id: string,
  options: any
) {
  await accounts.addPlugin(id, options)
}

async function removePlugin (
  config: Config,
  accounts: Accounts,
  backend: RateBackend,
  routeBroadcaster: RouteBroadcaster,

  id: string
) {
  routeBroadcaster.untrack(id)
  routeBroadcaster.reloadLocalRoutes()
  await accounts.removePlugin(id)
}

function getPlugin (
  accounts: Accounts,

  id: string
) {
  const accountService = accounts.get(id)
  if (accountService && accountService instanceof PluginAccountService) {
    return accountService.getPlugin()
  }
}

export default function createApp (opts?: object, container?: Injector) {
  const deps = container || reduct()

  const config = deps(Config)

  try {
    if (opts) {
      config.loadFromOpts(opts)
    } else {
      config.loadFromEnv()
    }
  } catch (err) {
    if (err.name === 'InvalidJsonBodyError') {
      log.warn('config validation error.')
      err.debugPrint(log.warn.bind(log))
      log.error('invalid configuration, shutting down.')
      throw new Error('failed to initialize due to invalid configuration.')
    }

    throw err
  }

  const accounts = deps(Accounts)
  const core = deps(Core)
  const routeBuilder = deps(RouteBuilder)
  const routeBroadcaster = deps(RouteBroadcaster)
  const backend = deps(RateBackend)
  const store = deps(Store)
  const adminApi = deps(AdminApi)

  accounts.registerProcessIlpPacketHandler(core.processIlpPacket.bind(core))
  accounts.on('add', async (account: AccountService) => {
    routeBroadcaster.track(account.id)
    routeBroadcaster.reloadLocalRoutes()
  })

  return {
    config,
    listen: partial(listen, config, accounts, backend, store, routeBuilder, routeBroadcaster, adminApi),
    addPlugin: partial(addPlugin, config, accounts, backend, routeBroadcaster),
    removePlugin: partial(removePlugin, config, accounts, backend, routeBroadcaster),
    getPlugin: partial(getPlugin, accounts),
    shutdown: partial(shutdown, accounts, routeBroadcaster)
  }
}
