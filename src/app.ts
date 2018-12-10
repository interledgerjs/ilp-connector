import { default as reduct, Injector } from 'reduct'
import { partial } from 'lodash'
import ILDCP = require('ilp-protocol-ildcp')
import {
  deserializeIlpPrepare,
  serializeIlpFulfill,
  serializeIlpReject,
  isFulfill
} from 'ilp-packet'
import * as Prometheus from 'prom-client'

import Config from './services/config'
import RouteBuilder from './services/route-builder'
import RouteBroadcaster from './services/route-broadcaster'
import Accounts from './services/accounts'
import RateBackend from './services/rate-backend'
import Store from './services/store'
import Account from './types/account'
import PluginAccount from './accounts/plugin'
import Core from './services/core'
import AdminApi from './services/admin-api'
import { create as createLogger } from './common/log'
const log = createLogger('app')

const version = require('../package.json').version

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

    // Start account providers
    // If no address is configured, wait for one to be inherited, give up after initialConnectTimeout
    await new Promise(async (resolve) => {
      const connectTimeout = setTimeout(() => {
        log.warn('one or more accounts failed to connect within the time limit, continuing anyway.')
        resolve()
      }, config.initialConnectTimeout)
      if (config.ilpAddress) {
        accounts.setOwnAddress(config.ilpAddress)
        await accounts.startup()
        resolve()
      } else {
        await accounts.startup()
        // This event will be emitted when we set the address
        accounts.once('address', () => {
          resolve()
        })
      }
      clearTimeout(connectTimeout)
    })

    if (config.routeBroadcastEnabled) {
      routeBroadcaster.start()
    }

    if (config.collectDefaultMetrics) {
      Prometheus.collectDefaultMetrics()
    }

    log.info('connector ready (republic attitude). address=%s version=%s', accounts.getOwnAddress(), version)
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
  routeBroadcaster.untrack(accounts.get(id))
  routeBroadcaster.reloadLocalRoutes()
  await accounts.removePlugin(id)
}

function getPlugin (
  accounts: Accounts,

  id: string
) {
  const accountService = accounts.get(id)
  if (accountService && accountService instanceof PluginAccount) {
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
  const pendingAccounts: Set<Account> = new Set()

  accounts.setup(deps)
  // TODO - Different behaviour for plugin profile
  accounts.registerCoreIlpPacketHandler(core.processIlpPacket.bind(core))
  accounts.registerCoreMoneyHandler(async () => { return })

  accounts.on('add', async (account: Account) => {

    if (accounts.getOwnAddress() === 'unknown') {
      if (account.info.relation === 'parent') {
        // If there is an explicit parent account configured to inherit from, and this is not it, skip it, otherwise return it
        if ((account.id === config.ilpAddressInheritFrom) || config.ilpAddressInheritFrom === '') {
          log.trace('connecting to parent to get address. accountId=%s', account.id)
          await account.startup()

          // TODO - Clean this up after removing extra serialization in ILDCP
          const address = (await ILDCP.fetch(async (data: Buffer) => {
            const reply = await account.sendIlpPacket(deserializeIlpPrepare(data))
            return isFulfill(reply) ? serializeIlpFulfill(reply) : serializeIlpReject(reply)
          })).clientAddress

          accounts.setOwnAddress(address)
          routeBroadcaster.track(account)
          routeBroadcaster.reloadLocalRoutes()

          // Start pending accounts that were held back waiting for the parent
          for (const pendingAccount of pendingAccounts) {
            await pendingAccount.startup()
            routeBroadcaster.track(pendingAccount)
            routeBroadcaster.reloadLocalRoutes()
          }
          pendingAccounts.clear()
        }
      } else {
        // Don't start this account up yet
        pendingAccounts.add(account)
      }
    } else {
      await account.startup()
      routeBroadcaster.track(account)
      routeBroadcaster.reloadLocalRoutes()
    }

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
