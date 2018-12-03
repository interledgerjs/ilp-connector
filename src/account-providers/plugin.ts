import reduct = require('reduct')
import Account, { AccountInfo } from '../types/account'
import AccountProvider, { AccountProviderOptions } from '../types/account-provider'
import PluginAccount from '../accounts/plugin'
import { PluginInstance } from '../types/plugin'
import Store from '../services/store'
import Config from '../services/config'
import { create as createLogger } from '../common/log'
const log = createLogger('plugin-account-provider')

export default class PluginAccountProvider implements AccountProvider {

  protected _handler?: (accountService: Account) => Promise<void>
  protected _address?: string
  protected _configuredAccounts: { [k: string]: AccountInfo }
  protected _store: Store
  constructor (deps: reduct.Injector, options?: AccountProviderOptions) {

    const config = deps(Config)
    this._configuredAccounts = {}
    const defaultAccountInfo = (options && options.defaultAccountInfo) ? options.defaultAccountInfo : {}
    Object.keys(config.accounts).forEach(accountId => {
      try {
        const accountInfo = Object.assign({}, defaultAccountInfo, config.accounts[accountId])
        config.validateAccount(accountId, accountInfo)
        this._configuredAccounts[accountId] = accountInfo
      } catch (err) {
        if (err.name === 'InvalidJsonBodyError') {
          log.error('validation error in account config. id=%s', accountId)
          err.debugPrint(log.warn.bind(log))
          throw new Error('error while adding account, see error log for details.')
        }
        throw err
      }
    })
    this._store = deps(Store)
  }

  public async create (accountId: string, accountInfo: AccountInfo) {
    if (!this._handler) throw new Error('no handler defined')

    let plugin
    if (typeof accountInfo.plugin === 'object') {
      plugin = accountInfo.plugin as PluginInstance
    } else {
      const pluginModule = accountInfo.plugin ? String(accountInfo.plugin) : 'ilp-plugin-btp'
      plugin = new (require(pluginModule))(accountInfo.options, {
        log: createLogger(`${accountInfo.plugin}[${accountId}]`),
        store: this._store.getPluginStore(accountId)
      })
    }
    await this._handler(new PluginAccount(accountId, accountInfo, plugin))
  }

  async startup (handler: (accountService: Account) => Promise<void>) {
    if (this._handler) throw new Error('already started')
    this._handler = handler

    for (let accountId of Object.keys(this._configuredAccounts)) {
      await this.create(accountId, this._configuredAccounts[accountId])
    }
    log.debug('started plugin account provider')
  }

  async shutdown () {
    this._handler = undefined
  }

}
