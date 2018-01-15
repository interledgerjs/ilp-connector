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

  constructor (deps: reduct.Injector) {
    const config = deps(Config)
    const accounts = deps(Accounts)

    const Backend: BackendConstructor = loadModuleOfType('backend', config.backend || DEFAULT_BACKEND)
    this.backend = new Backend(Object.assign({
      spread: config.spread
    }, config.backendConfig), {
      getInfo: (account: string) => accounts.getInfo(account)
    })
  }

  connect (...args: any[]) {
    return this.backend.connect(...args)
  }

  getRate (sourceAccount: string, destinationAccount: string) {
    return this.backend.getRate(sourceAccount, destinationAccount)
  }

  submitPayment (params: SubmitPaymentParams) {
    return this.backend.submitPayment(params)
  }
}
