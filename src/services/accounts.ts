import reduct = require('reduct')
import Store from '../services/store'
import Config from './config'
import { EventEmitter } from 'events'
import ILDCP = require('ilp-protocol-ildcp')
import { loadModuleOfType } from '../lib/utils'
import {
  deserializeIlpPrepare,
  serializeIlpFulfill,
  serializeIlpReject,
  isFulfill,
  IlpPrepare,
  IlpPacketHander, IlpReply
} from 'ilp-packet'
import { create as createLogger } from '../common/log'
import { MiddlewareDefinition } from '../types/middleware'
import { AccountService } from '../types/account-service'
import { AccountServiceProvider, AccountServiceProviderDefinition } from '../types/account-service-provider'
import { AccountInfo } from '../types/accounts'
import PluginAccountServiceProvider from '../account-service-providers/plugin'
import MiddlewareManager from './middleware-manager'
import Stats from './stats'
import { MoneyHandler, VoidHandler } from '../types/plugin'
import {codes} from 'ilp-packet/dist/src/errors'
const log = createLogger('accounts')

const PLUGIN_ACCOUNT_PROVIDER = 'plugin'
const BUILTIN_ACCOUNT_MIDDLEWARES: { [key: string]: MiddlewareDefinition } = {
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
export default class Accounts extends EventEmitter {
  protected _config: Config
  protected _store: Store
  protected _stats: Stats
  protected _middlewareManager: MiddlewareManager
  protected _address: string
  protected _accounts: Map<string, AccountService>
  protected _pendingAccounts: Set<AccountService>
  protected _accountProviders: Map<string, AccountServiceProvider>
  protected _outgoingIlpPacketPipelines: Map<string, IlpPacketHander>
  protected _outgoingMoneyPipelines: Map<string, MoneyHandler>
  protected _shutdownPipelines: Map<string, VoidHandler>
  protected _processIlpPacket?: (packet: IlpPrepare, accountId: string, outbound: (packet: IlpPrepare, accountId: string) => Promise<IlpReply>) => Promise<IlpReply>

  constructor (deps: reduct.Injector) {
    super()

    this._config = deps(Config)
    this._store = deps(Store)
    this._stats = deps(Stats)
    this._middlewareManager = new MiddlewareManager({
      getInfo: (accountId: string) => {
        let account = this.get(accountId)
        return account.info
      } ,
      getOwnAddress: this.getOwnAddress.bind(this),
      sendMoney: (amount: string): Promise<void> => { return Promise.resolve()},
      stats: this._stats,
      config: this._config
    })
    this._address = this._config.ilpAddress || 'unknown'
    this._pendingAccounts = new Set()
    this._accounts = new Map()
    this._accountProviders = new Map()
    this._outgoingIlpPacketPipelines = new Map()
    this._outgoingMoneyPipelines = new Map()
    this._shutdownPipelines = new Map()

    this._loadPluginsAccountServiceProvider()
    const customAccountProviderConfig: { [key: string]: AccountServiceProviderDefinition } =
      this._config['account-providers'] || {}

    for (const name of Object.keys(customAccountProviderConfig)) {
      this._loadProvider(name, customAccountProviderConfig[name])
    }

  }

  registerProcessIlpPacketHandler (handler: (packet: IlpPrepare, accountId: string, outbound: (packet: IlpPrepare, accountId: string) => Promise<IlpReply>) => Promise<IlpReply>) {
    this._processIlpPacket = handler
  }

  // Handle new account from one of the account providers
  private async _handleNewAccount (account: AccountService) {

    this._accounts.set(account.id, account)

    // Required to ensure you dont need to bind the account context to itself and also add error handling on outgoing
    const sendIlpPacket = async (packet: IlpPrepare) => {
      try {
        return await account.sendIlpPacket(packet)
      } catch (e) {
        let err = e
        if (!err || typeof err !== 'object') {
          err = new Error('non-object thrown. value=' + e)
        }

        if (!err.ilpErrorCode) {
          err.ilpErrorCode = codes.F02_UNREACHABLE
        }

        err.message = 'failed to send packet: ' + err.message

        throw err
      }
    }

    const {
      startupPipeline,
      incomingIlpPacketPipeline,
      incomingMoneyPipeline,
      outgoingIlpPacketPipeline,
      outgoingMoneyPipeline,
      shutdownPipeline } = await this._middlewareManager.setupHandlers(account.id, {
        outgoingIlpPacket: sendIlpPacket,
        outgoingMoney: (amount: string) => account.sendMoney(amount),
        incomingIlpPacket: (packet: IlpPrepare) => this._processIlpPacket!(packet, account.id, this.sendIlpPacket.bind(this)),
        incomingMoney: (amount: string) => this.sendMoney(amount, account.id)
      })
    account.registerIlpPacketHandler(incomingIlpPacketPipeline)
    account.registerMoneyHandler(incomingMoneyPipeline)

    this._outgoingIlpPacketPipelines.set(account.id, outgoingIlpPacketPipeline)
    this._outgoingMoneyPipelines.set(account.id, outgoingMoneyPipeline)
    this._shutdownPipelines.set(account.id, shutdownPipeline)
    await startupPipeline(undefined)

    if (!this._address) {
      if (this._config.ilpAddressInheritFrom) {
        if (account.id === this._config.ilpAddressInheritFrom) {
          this._getAddressFromParent(account)
        }
      } else if (account.info.relation === 'parent') {
        this._getAddressFromParent(account)
      }
      this._pendingAccounts.add(account)
    } else {
      this._emitAccount(account, true)
    }

  }

  sendIlpPacket (packet: IlpPrepare, accountId: string) {
    const handler = this._outgoingIlpPacketPipelines.get(accountId)

    if (!handler) throw new Error('Can\'t find outgoing ilp packet pipeline for accountId=' + accountId)
    return this.get(accountId).sendIlpPacket(packet)
    // return handler(packet)
  }

  sendMoney (amount: string, accountId: string) {
    const handler = this._outgoingMoneyPipelines.get(accountId)

    if (!handler) throw new Error('Can\'t find outgoing money pipeline for accountId=' + accountId)

    return handler(amount)
  }

  private async _emitAccount (account: AccountService, startFirst: boolean = true): Promise<void> {
    if (startFirst) {
      await account.startup()
    }
    this.emit('add', account)
  }

  private async _getAddressFromParent (account: AccountService): Promise<void> {
    log.trace('connecting to parent. accountId=%s', account.id)
    await account.startup()

    // TODO - Clean this up after removing extra serializtion in ILDCP
    const address = (await ILDCP.fetch(async (data: Buffer) => {
      const reply = await account.sendIlpPacket(deserializeIlpPrepare(data))
      return isFulfill(reply) ? serializeIlpFulfill(reply) : serializeIlpReject(reply)
    })).clientAddress

    this._setOwnAddress(address)
    this._emitAccount(account, false)
  }

  private _loadProvider (name: string, definition: AccountServiceProviderDefinition) {
    const AccountServiceProviderConstructor = loadModuleOfType('account-provider', definition.type)
    const provider = new AccountServiceProviderConstructor(definition.options || {}, {
      config: this._config.accounts,
      store: this._store
    }) as AccountServiceProvider
    this._accountProviders.set(name, provider)
  }

  // TODO - Use default loader for this provider too
  private _loadPluginsAccountServiceProvider () {

    const accountConfig: { [key: string]: AccountInfo } = {}
    Object.keys(this._config.accounts).forEach(accountId => {
      try {
        const accountInfo = this._config.accounts[accountId]
        this._config.validateAccount(accountId, accountInfo)
        accountConfig[accountId] = accountInfo
      } catch (err) {
        if (err.name === 'InvalidJsonBodyError') {
          log.error('validation error in account config. id=%s', accountId)
          err.debugPrint(log.warn.bind(log))
          throw new Error('error while adding account, see error log for details.')
        }
        throw err
      }
    })

    const middleware: string[] = []
    const disabledMiddlewareConfig: string[] = this._config.disableMiddleware || []
    for (const name of Object.keys(BUILTIN_ACCOUNT_MIDDLEWARES)) {
      if (disabledMiddlewareConfig.includes(name)) {
        continue
      }
      middleware.push(name)
    }

    // TODO - Extract Middleware into a stand-alone module and reference from here
    // We should pass in Middleware definitions not just types
    const provider = new PluginAccountServiceProvider({ middleware }, {
      accounts: accountConfig,
      createStore: (prefix: string) => {
        return {
          get: (key: string) => this._store.get(prefix + key),
          del: (key: string) => this._store.del(prefix + key),
          put: (key: string, value: string) => this._store.put(prefix + key, value)
        }
      },
      createLogger: (prefix: string) => createLogger(`plugin-account-service[${prefix}]`)
    })
    this._accountProviders.set(PLUGIN_ACCOUNT_PROVIDER, provider)
  }

  async startup (): Promise<string> {
    if (!this._processIlpPacket) throw new Error('no processIlpPacketHandler registered')

    return new Promise<string>((resolve) => {
      if (!this._address) {
        const setOwnAddress = this._setOwnAddress
        this._setOwnAddress = (address: string) => {
          resolve(address)
          setOwnAddress(address)
          this._setOwnAddress = setOwnAddress
        }
      } else {
        resolve(this._address)
      }
      this._accountProviders.forEach(provider => {
        provider.startup(account => {
          this._handleNewAccount(account)
        })
      })
    })
  }

  public getOwnAddress () {
    return this._address
  }

  private _setOwnAddress (newAddress: string) {
    log.trace('setting ilp address. oldAddress=%s newAddress=%s', this._address, newAddress)
    this._address = newAddress
    this._pendingAccounts.forEach(account => {
      this._emitAccount(account, true)
    })
    this._pendingAccounts.clear()
  }

  getChildAddress (accountId: string) {
    const info = this.get(accountId).info

    if (info.relation !== 'child') {
      throw new Error('Can\'t generate child address for account that is isn\'t a child')
    }

    const ilpAddressSegment = info.ilpAddressSegment || accountId

    return this._address + '.' + ilpAddressSegment
  }

  public has (accountId: string) {
    return this._accounts.has(accountId)
  }

  public keys () {
    return this._accounts.keys()
  }

  public get (accountId: string): AccountService {
    const accountService = this._accounts.get(accountId)
    if (!accountService) {
      log.error('could not find account service for account id. accountId=%s', accountId)
      throw new Error('unknown account id. accountId=' + accountId)
    }
    return accountService
  }

  public async addPlugin (accountId: string, creds: any) {
    log.info('add plugin for account. accountId=%s', accountId)
    const accountProvider = this._accountProviders.get(PLUGIN_ACCOUNT_PROVIDER) as PluginAccountServiceProvider
    if (accountProvider) {
      accountProvider.create(accountId, creds)
    } else {
      throw new Error('Can\'t add new plugin. The PluginAccountServiceProvider is not configured')
    }
  }

  public async removePlugin (accountId: string) {
    log.info('remove plugin for account. accountId=%s', accountId)
    // TODO - What should we do here?
  }

  public getStatus () {
    const accounts = {}
    this._accounts.forEach((account, accountId) => {
      accounts[accountId] = {
        // Set info.options to undefined so that credentials aren't exposed.
        info: Object.assign({}, account.info, { options: undefined }),
        connected: account.isConnected()
      }
    })
    return {
      address: this._address,
      accounts
    }
  }

}
