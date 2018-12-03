import reduct = require('reduct')
import Account, { AccountInfo } from '../types/account'
import AccountProvider, { AccountProviderOptions } from '../types/account-provider'
import Store from '../services/store'
import { create as createLogger } from '../common/log'
const log = createLogger('server-account-provider')

export default abstract class ServerAccountProvider<ConnectionType> implements AccountProvider {

  protected _handler?: (accountService: Account) => Promise<void>
  protected _store: Store
  protected _port: number
  protected _accountInfo: AccountInfo

  constructor (deps: reduct.Injector, options: AccountProviderOptions) {
    this._store = deps(Store)
    if (!options || !options.listener || !options.listener.port) {
      throw new Error('ServerAccountProvider requires listener to be configured.')
    }
    this._port = options.listener.port
    if (!options || !options.defaultAccountInfo) {
      throw new Error('ServerAccountProvider requires default account info to be configured.')
    }
    this._accountInfo = options.defaultAccountInfo
  }

  protected abstract async _listen (): Promise<void>
  protected abstract async _handleNewConnection (connection: ConnectionType): Promise<void>
  protected abstract async _stop (): Promise<void>

  async startup (handler: (accountService: Account) => Promise<void>) {
    if (this._handler) throw new Error('already started')
    this._handler = handler
    await this._listen()
  }

  async shutdown () {
    this._handler = undefined
    await this._stop()
  }

}
