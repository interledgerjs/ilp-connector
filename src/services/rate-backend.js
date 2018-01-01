'use strict'

const path = require('path')
const Config = require('./config')
const Accounts = require('./accounts')

const { loadModuleFromPathOrDirectly } = require('../lib/utils')

class RateBackend {
  constructor (deps) {
    const config = deps(Config)
    const accounts = deps(Accounts)

    const Backend = getBackend(config.get('backend'))
    this.backend = new Backend({
      backendUri: config.get('backendUri'),
      spread: config.get('fxSpread'),
      getInfo: (account) => accounts.getInfo(account),
      getAssetCode: (account) => accounts.getAssetCode(account)
    })
  }

  connect (...args) {
    return this.backend.connect(...args)
  }

  getRate (...args) {
    return this.backend.getRate(...args)
  }

  submitPayment (...args) {
    return this.backend.submitPayment(...args)
  }
}

function getBackend (backend) {
  const module = loadModuleFromPathOrDirectly(path.resolve(__dirname, '../backends/'), backend)

  if (!module) {
    throw new Error('Backend not found at "' + backend + '" or "/backends/' + backend + '"')
  }

  return require(module)
}

module.exports = RateBackend
