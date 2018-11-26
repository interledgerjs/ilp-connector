import * as reduct from 'reduct'
import Config from '../services/config'
import { AccountManagerInstance } from '../types/account-manager'
import Store from '../services/store'
import { create as createLogger } from '../common/log'
import { EventEmitter } from 'events'
import { AccountService, AccountServiceFactory, PluginAccountServiceFactory } from 'ilp-account-service'
import { deserializeIlpPrepare, serializeIlpFulfill, serializeIlpReject, isFulfill } from 'ilp-packet'
import ILDCP = require('ilp-protocol-ildcp')
import { MiddlewareDefinition } from '../types/middleware'
import { AccountInfo } from '../types/accounts'

const log = createLogger('plugin-account-manager')

const BUILTIN_MIDDLEWARES: { [key: string]: MiddlewareDefinition } = {
  errorHandler: {
    type: 'error-handler'
  },
  rateLimit: {
    type: 'rate-limit'
  },
  throughput: {
    type: 'throughput'
  },
  balance: {
    type: 'balance'
  },
  expire: {
    type: 'expire'
  }
}

export default class PluginAccountManager extends EventEmitter implements AccountManagerInstance {

  protected config: Config
  protected store: Store
  protected accountServices: Map<string, AccountService>
  protected newAccountHandler?: (accountId: string, accountService: AccountService) => Promise<void>
  protected removeAccountHandler?: (accountId: string) => void
  protected accountServiceFactory: AccountServiceFactory
  protected middleware: string[]

  constructor (deps: reduct.Injector) {

    super()

    this.config = deps(Config)
    this.store = deps(Store)
    this.accountServices = new Map()
    const middleware: string[] = []
    const disabledMiddlewareConfig: string[] = this.config.disableMiddleware || []
    for (const name of Object.keys(BUILTIN_MIDDLEWARES)) {
      if (disabledMiddlewareConfig.includes(name)) {
        continue
      }

      middleware.push(name)
    }
    for (let id of Object.keys(this.config.accounts)) {
      this._validateAccountInfo(id, this.config.accounts[id] as AccountInfo)
    }
    this.middleware = middleware

    this.accountServiceFactory = new PluginAccountServiceFactory({accounts: this.config.accounts, middleware: middleware})
    this.accountServiceFactory.registerNewAccountHandler(async (accountId: string, service: AccountService) => {
      this.accountServices.set(accountId, service)
      if (this.newAccountHandler) await this.newAccountHandler(accountId, service)

      await service.startup()
    })
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

      await this.addAccount(inheritFrom, credentials[inheritFrom] as AccountInfo)

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
    await this.accountServiceFactory.startup()
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

  private _validateAccountInfo (id: string, credentials: AccountInfo) {
    try {
      this.config.validateAccount(id, credentials)
      if (typeof credentials.plugin !== 'string') {
        throw new Error('no plugin configured.')
      }
    } catch (err) {
      if (err.name === 'InvalidJsonBodyError') {
        log.error('validation error in account config. id=%s', id)
        err.debugPrint(log.warn.bind(log))
        throw new Error('error while adding account, see error log for details.')
      }
      throw err
    }
  }

  async addAccount (accountId: string, accountConfig: AccountInfo) {

    this._validateAccountInfo(accountId, accountConfig)

    const accountService = this.accountServiceFactory.create(accountId, accountConfig, this.middleware)
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
