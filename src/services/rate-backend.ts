'use strict'

import { resolve } from 'path'
import Config from './config'
import Accounts from './accounts'
import reduct = require('reduct')
import { IBackend, SubmitPaymentParams } from '../types/backend'

const { loadModuleFromPathOrDirectly } = require('../lib/utils')

export default class RateBackend implements IBackend {
  protected backend: IBackend

  constructor (deps: reduct.Injector) {
    const config = deps(Config)
    const accounts = deps(Accounts)

    const Backend = getBackend(config.get('backend'))
    this.backend = new Backend({
      backendUri: config.get('backendUri'),
      spread: config.get('fxSpread'),
      getInfo: (account: string) => accounts.getInfo(account),
      getAssetCode: (account: string) => accounts.getAssetCode(account)
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

function getBackend (backend: string) {
  const module = loadModuleFromPathOrDirectly(resolve(__dirname, '../backends/'), backend)

  if (!module) {
    throw new Error('Backend not found at "' + backend + '" or "/backends/' + backend + '"')
  }

  return require(module).default
}
