import Config from './config'
import Accounts from './accounts'
import reduct = require('reduct')
import {
  BackendConstructor,
  BackendInstance,
  SubmitPaymentParams
} from '../types/backend'

import { loadModuleOfType } from '../lib/utils'

const DEFAULT_BACKEND = 'one-to-one'

export default class RateBackend implements BackendInstance {
  protected backend: BackendInstance
  private accounts: Accounts

  constructor (deps: reduct.Injector) {
    const config = deps(Config)
    this.accounts = deps(Accounts)

    const Backend: BackendConstructor = loadModuleOfType('backend', config.backend || DEFAULT_BACKEND)
    this.backend = new Backend(Object.assign({
      spread: config.spread
    }, config.backendConfig), {
      getInfo: (account: string) => this.accounts.getInfo(account)
    })
  }

  connect () {
    return this.backend.connect()
  }

  getRate (sourceAccount: string, destinationAccount: string) {
    return this.backend.getRate(sourceAccount, destinationAccount)
  }

  submitPayment (params: SubmitPaymentParams) {
    return this.backend.submitPayment(params)
  }

  async getStatus () {
    const rates = {}
    const accountIds = this.accounts.getAccountIds()
    for (const srcAccount of accountIds) {
      const accountRates = rates[srcAccount] = {}
      for (const dstAccount of accountIds) {
        if (srcAccount === dstAccount) continue
        accountRates[dstAccount] = await this.backend.getRate(srcAccount, dstAccount)
      }
    }
    return rates
  }
}
