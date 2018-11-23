import * as reduct from 'reduct'
import Config from '../services/config'
import { AccountManagerInstance } from '../types/account-manager'
import Store from '../services/store'
import { create as createLogger } from '../common/log'
import { EventEmitter } from 'events'
import { AccountService, PluginAccountService } from 'ilp-account-service'
import { deserializeIlpPrepare, serializeIlpFulfill, serializeIlpReject, isFulfill } from 'ilp-packet'
import ILDCP = require('ilp-protocol-ildcp')

const log = createLogger('plugin-account-manager')

export default class PluginAccountManager extends EventEmitter implements AccountManagerInstance {

  protected config: Config
  protected store: Store
  protected accountServices: Map<string, AccountService>
  protected newAccountHandler?: (accountId: string, accountService: AccountService) => Promise<void>
  protected removeAccountHandler?: (accountId: string) => void

  constructor (deps: reduct.Injector) {

    super()

    this.config = deps(Config)
    this.store = deps(Store)
    this.accountServices = new Map()
  }

  exists (accountId: string) {
    return this.accountServices.has(accountId)
  }

  registerNewAccountHandler (handler: (accountId: string, accountService: AccountService) => Promise<void>) {

    if (this.newAccountHandler) {
      log.error('New account handler already exists')
      throw new Error('New account handler already exists')
    }

    log.info('registering new account handler.')

    this.newAccountHandler = handler

  }

  deregisterNewAccountHandler () {

    log.info('deregistering new account handler.')

    this.newAccountHandler = undefined

  }

  registerRemoveAccountHandler (handler: (accountId: string) => void) {

    if (this.removeAccountHandler) {
      log.error('Remove account handler already exists')
      throw new Error('Remove account handler already exists')
    }

    log.info('registering remove account handler.')

    this.removeAccountHandler = handler

  }

  deregisterRemoveAccountHandler () {

    log.info('account manager deregistering removing plugin handler.')

    this.removeAccountHandler = undefined

  }

  public async loadIlpAddress () {
    const credentials = this.config.accounts

    const map = new Map(Object.entries(credentials))
    const inheritFrom = this.config.ilpAddressInheritFrom ||
      // Get account id of first parent
      [...map]
        .filter(([key, value]) => value.relation === 'parent')
        .map(([key]) => key)[0]

    if (this.config.ilpAddress === 'unknown' && !inheritFrom) {
      throw new Error('When there is no parent, ILP address must be specified in configuration.')
    } else if (this.config.ilpAddress === 'unknown' && inheritFrom) {

      await this.addAccount(inheritFrom, credentials[inheritFrom])

      // TODO - Fix up after removing extra serializtion in ILDCP
      const ildcpInfo = await ILDCP.fetch(async (data: Buffer) => {
        const reply = await this.getAccountService(inheritFrom).sendIlpPacket(deserializeIlpPrepare(data))
        return isFulfill(reply) ? serializeIlpFulfill(reply) : serializeIlpReject(reply)
      })

      return ildcpInfo.clientAddress
    }

    return this.config.ilpAddress || 'unknown'
  }

  public async startup () {
    const credentials = this.config.accounts

    for (let id of Object.keys(credentials)) {
      await this.addAccount(id, credentials[id])
    }

  }

  public async shutdown () {

    log.info('shutting down')

    this.accountServices.forEach((accountService, accountId) => this.removeAccount(accountId))

  }

  public getAccountService (accountId: string): AccountService {
    const accountService = this.accountServices.get(accountId)
    if (!accountService) {
      log.error('could not find account service for account id. accountId=%s', accountId)
      throw new Error('unknown account id. accountId=' + accountId)
    }
    return accountService
  }

  public getAccounts () {
    return this.accountServices
  }

  async addAccount (accountId: string, accountConfig: any) {

    // Validate config
    try {
      this.config.validateAccount(accountId, accountConfig)
      if (typeof accountConfig.plugin !== 'string') {
        throw new Error('no plugin configured.')
      }
    } catch (err) {
      if (err.name === 'InvalidJsonBodyError') {
        log.error('validation error in account config. id=%s', accountId)
        err.debugPrint(log.warn.bind(log))
        throw new Error('error while adding account, see error log for details.')
      }
      throw err
    }

    const api: any = {}
    // Lazily create plugin utilities
    Object.defineProperty(api, 'store', {
      get: () => {
        return this.store.getPluginStore(accountId)
      }
    })
    Object.defineProperty(api, 'log', {
      get: () => {
        return createLogger(`${accountConfig.plugin}[${accountId}]`)
      }
    })

    const Plugin = require(accountConfig.plugin)
    const opts = Object.assign({}, accountConfig.options)
    const plugin = new Plugin(opts, api)

    log.info('started plugin for account ' + accountId)

    const accountService = new PluginAccountService(accountId, accountConfig, plugin, [])
    this.accountServices.set(accountId, accountService)

    if (this.newAccountHandler) {
      await this.newAccountHandler(accountId, accountService)
    }
    // TODO Should this await?
    await accountService.startup()
  }

  async removeAccount (accountId: string) {

    const accountService = this.getAccountService(accountId)

    accountService.shutdown()
    accountService.deregisterIlpPacketHandler()
    accountService.deregisterConnectHandler()
    accountService.deregisterDisconnectHandler()

    if (this.removeAccountHandler) this.removeAccountHandler(accountId)

    this.accountServices.delete(accountId)
  }
}
