import { AccountService } from '../types/account-service'
import { AccountServiceProvider, AccountServiceProviderServices } from '../types/account-service-provider'
import { AccountInfo } from '../types/accounts'
import PluginAccountService from '../account-services/plugin'
import { PluginInstance } from '../types/plugin'
import { StoreInstance } from '../types/store'

export default class PluginAccountServiceProvider implements AccountServiceProvider {

  protected _handler?: (accountService: AccountService) => void
  protected _address?: string
  protected _configuredAccounts: { [k: string]: AccountInfo }
  protected _middleware: string[]
  protected _isStarted: boolean = false
  protected _createStore: (namespace: string) => StoreInstance
  protected _createLogger: (namespace: string) => {}

  constructor (options: {middleware: string[]}, services: AccountServiceProviderServices) {
    this._configuredAccounts = services.accounts || {}
    this._middleware = options.middleware
    this._createLogger = services.createLogger,
    this._createStore = services.createStore
  }

  public create (accountId: string, accountInfo: AccountInfo) {
    if (!this._handler) throw new Error('no handler defined')

    let plugin
    if (typeof accountInfo.plugin === 'object') {
      plugin = accountInfo.plugin as PluginInstance
    } else {
      const pluginModule = accountInfo.plugin ? String(accountInfo.plugin) : 'ilp-plugin-btp'
      plugin = new (require(pluginModule))(accountInfo.options, {
        log: this._createLogger(accountId),
        store: this._createStore(accountId)
      })
    }
    this._handler(new PluginAccountService(accountId, accountInfo, plugin, this._middleware))
  }

  async startup (handler: (accountService: AccountService) => void) {
    if (this._handler) throw new Error('already started')
    this._handler = handler

    // TODO - Get parent
    for (let accountId of Object.keys(this._configuredAccounts)) {
      this.create(accountId, this._configuredAccounts[accountId])
    }
  }

  async shutdown () {
    this._handler = undefined
  }

}
