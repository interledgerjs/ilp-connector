import reduct = require('reduct')
import Account, { AccountInfo } from '../types/account'
import AccountProvider, { AccountProviderOptions } from '../types/account-provider'
import LoopBackAccount from '../accounts/loop-back'
import Store from '../services/store'
import { create as createLogger } from '../common/log'
const log = createLogger('loop-back-account-provider')

export default class LoopBackAccountProvider implements AccountProvider {

  protected _handler?: (accountService: Account) => Promise<void>
  protected _configuredAccounts: string[]
  protected _accountInfo: AccountInfo
  protected _store: Store

  constructor (deps: reduct.Injector, options: AccountProviderOptions) {
    if (!options || !options.defaultAccountInfo) {
      throw new Error('LoopBackAccountProvider requires default account info to be configured.')
    }

    this._configuredAccounts = options.loopBackAccounts || []
    this._accountInfo = options.defaultAccountInfo
    this._store = deps(Store)
  }

  public async create (accountId: string, accountInfo: AccountInfo) {
    if (!this._handler) throw new Error('no handler defined')

    await this._handler(new LoopBackAccount(accountId, accountInfo))
  }

  async startup (handler: (accountService: Account) => Promise<void>) {
    if (this._handler) throw new Error('already started')
    this._handler = handler

    for (let accountId of this._configuredAccounts) {
      await this.create(accountId, this._accountInfo)
    }
    log.debug('started loop back account provider')
  }

  async shutdown () {
    this._handler = undefined
  }

}
