'use strict'

const Config = require('./config')
const Accounts = require('./accounts')

class RateBackend {
  constructor (deps) {
    const config = deps(Config)
    const accounts = deps(Accounts)

    const Backend = getBackend(config.get('backend'))
    this.backend = new Backend({
      backendUri: config.get('backendUri'),
      spread: config.get('fxSpread'),
      getInfo: (ledger) => accounts.getPlugin(ledger).getInfo(),
      getCurrency: (ledger) => accounts.getCurrency(ledger)
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
  if (moduleExists('../backends/' + backend)) return require('../backends/' + backend)
  if (moduleExists(backend)) return require(backend)
  throw new Error('Backend not found at "' + backend + '" or "/backends/' + backend + '"')
}

function moduleExists (path) {
  try {
    require.resolve(path)
    return true
  } catch (err) {
    return false
  }
}

module.exports = RateBackend
