import reduct = require('reduct')
import Store from '../services/store'
import Config from './config'
import { EventEmitter } from 'events'
import { AccountInfo, AccountService, AccountServiceProvider, AccountServiceProviderDefinition, PluginAccountServiceProvider } from 'ilp-account-service'
import ILDCP = require('ilp-protocol-ildcp')
import { loadModuleOfType } from '../lib/utils'
import { deserializeIlpPrepare, serializeIlpFulfill, serializeIlpReject, isFulfill } from 'ilp-packet'
import { create as createLogger } from '../common/log'
import { MiddlewareDefinition } from '../types/middleware'
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
  protected config: Config
  protected store: Store
  protected address: string
  protected accounts: Map<string, AccountService>
  protected _pendingAccounts: Set<AccountService>
  protected _accountProviders: Map<string, AccountServiceProvider>

  constructor (deps: reduct.Injector) {
    super()
    this.config = deps(Config)
    this.store = deps(Store)
    this.address = this.config.ilpAddress || 'unknown'
    this._pendingAccounts = new Set()
    this.accounts = new Map()
    this._accountProviders = new Map()

    this._loadPluginsAccountServiceProvider()
    const customAccountProviderConfig: { [key: string]: AccountServiceProviderDefinition } =
      this.config['account-providers'] || {}

    for (const name of Object.keys(customAccountProviderConfig)) {
      this._loadProvider(name, customAccountProviderConfig[name])
    }

  }

  // Handle new account from one of the account providers
  private _onAccount (account: AccountService) {

    this.accounts.set(account.id, account)

    if (!this.address) {
      if (this.config.ilpAddressInheritFrom) {
        if (account.id === this.config.ilpAddressInheritFrom) {
          this._getAddressFromParent(account)
        }
      } else if (account.info.relation === 'parent') {
        this._getAddressFromParent(account)
      }
      this._pendingAccounts.add(account)
    } else {
      this.emit('add', account)
    }

  }
  private async _getAddressFromParent (account: AccountService): Promise<void> {
    log.trace('connecting to parent. accountId=%s', account.id)
    await account.startup()

    // TODO - Clean this up after removing extra serializtion in ILDCP
    const address = (await ILDCP.fetch(async (data: Buffer) => {
      const reply = await account.sendIlpPacket(deserializeIlpPrepare(data))
      return isFulfill(reply) ? serializeIlpFulfill(reply) : serializeIlpReject(reply)
    })).clientAddress

    this.setOwnAddress(address)
  }

  private _loadProvider (name: string, definition: AccountServiceProviderDefinition) {
    const AccountServiceProviderConstructor = loadModuleOfType('account-provider', definition.type)
    const provider = new AccountServiceProviderConstructor(definition.options || {}, {
      config: this.config.accounts,
      store: this.store
    }) as AccountServiceProvider
    this._accountProviders.set(name, provider)
  }

  // TODO - Use default loader for this provider too
  private _loadPluginsAccountServiceProvider () {

    const accountConfig: { [key: string]: AccountInfo } = {}
    Object.keys(this.config.accounts).forEach(accountId => {
      try {
        const accountInfo = this.config.accounts[accountId]
        this.config.validateAccount(accountId, accountInfo)
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
    const disabledMiddlewareConfig: string[] = this.config.disableMiddleware || []
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
          get: (key: string) => this.store.get(prefix + key),
          del: (key: string) => this.store.del(prefix + key),
          put: (key: string, value: string) => this.store.put(prefix + key, value)
        }
      },
      createLogger: (prefix: string) => createLogger(`plugin-account-service[${prefix}]`)
    })
    this._accountProviders.set(PLUGIN_ACCOUNT_PROVIDER, provider)
  }

  async startup (): Promise<string> {
    return new Promise<string>((resolve) => {
      if (!this.address) {
        const _setOwnAddress = this.setOwnAddress
        this.setOwnAddress = (address: string) => {
          resolve(address)
          _setOwnAddress(address)
          this.setOwnAddress = _setOwnAddress
        }
      } else {
        resolve(this.address)
      }
      this._accountProviders.forEach(provider => {
        provider.startup(account => {
          this._onAccount(account)
        })
      })
    })
  }

  getOwnAddress () {
    return this.address
  }

  setOwnAddress (newAddress: string) {
    log.trace('setting ilp address. oldAddress=%s newAddress=%s', this.address, newAddress)
    this.address = newAddress
    setImmediate(() => {
      this.accounts.forEach(account => {
        this.emit('add', account)
      })
    })
  }

  exists (accountId: string) {
    return this.accounts.has(accountId)
  }

  getAccountIds () {
    return Array.from(this.accounts.keys())
  }

  getAssetCode (accountId: string) {
    const account = this.accounts.get(accountId)

    if (!account) {
      log.error('no currency found. account=%s', accountId)
      return undefined
    }

    return account.info.assetCode
  }

  async addPlugin (accountId: string, creds: any) {
    log.info('add plugin for account. accountId=%s', accountId)
    const accountProvider = this._accountProviders.get(PLUGIN_ACCOUNT_PROVIDER) as PluginAccountServiceProvider
    if (accountProvider) {
      accountProvider.create(accountId, creds)
    } else {
      throw new Error('Can\'t add new plugin. The PluginAccountServiceProvider is not configured')
    }
  }

  async removePlugin (accountId: string) {
    log.info('remove plugin for account. accountId=%s', accountId)
    // TODO - What should we do here?
  }

  getInfo (accountId: string): AccountInfo {
    const account = this.accounts.get(accountId)
    if (!account) {
      throw new Error('unknown account id. accountId=' + accountId)
    }
    return account.info
  }

  getChildAddress (accountId: string) {
    const info = this.getInfo(accountId)

    if (info.relation !== 'child') {
      throw new Error('Can\'t generate child address for account that is isn\'t a child')
    }

    const ilpAddressSegment = info.ilpAddressSegment || accountId

    return this.address + '.' + ilpAddressSegment
  }

  getStatus () {
    const accounts = {}
    this.accounts.forEach((account, accountId) => {
      accounts[accountId] = {
        // Set info.options to undefined so that credentials aren't exposed.
        info: Object.assign({}, account.info, { options: undefined }),
        connected: account.isConnected()
      }
    })
    return {
      address: this.address,
      accounts
    }
  }

  getAccountService (accountId: string): AccountService {
    const accountService = this.accounts.get(accountId)
    if (!accountService) {
      log.error('could not find account service for account id. accountId=%s', accountId)
      throw new Error('unknown account id. accountId=' + accountId)
    }
    return accountService
  }

}
