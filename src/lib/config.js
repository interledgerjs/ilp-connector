'use strict'

const Config = require('five-bells-shared').Config
const Utils = require('../lib/utils')

class ConnectorConfig extends Config {
  constructor () {
    super('connector')
  }

  parseConnectorConfig () {
    // List of ledgers this connector has accounts on (used to auto-generate pairs)
    // e.g. ["USD@http://usd-ledger.example","EUR@http://eur-ledger.example/some/path"]
    this.ledgers = JSON.parse(this.getEnv('LEDGERS') || '[]').map(ledger => {
      const sep = ledger.indexOf('@')
      return { currency: ledger.substr(0, sep), ledger: ledger.substr(sep + 1) }
    })

    // Currency pairs traded should be specified as
    // [["USD@http://usd-ledger.example/USD","EUR@http://eur-ledger.example"],...]
    this.tradingPairs = JSON.parse(this.getEnv('PAIRS') || 'false') || this.generateDefaultPairs()

    // Credentials should be specified as a map of the form
    // {
    //    "<ledger_uri>": {
    //      "account_uri": "...",
    //      "username": "...",
    //      "password": "..."
    //    }
    // }
    this.ledgerCredentials = JSON.parse(this.getEnv('CREDENTIALS') || '{}')

    this.features = {}
    this.features.debugAutoFund = !!this.getEnv('DEBUG_AUTOFUND')
    this.admin = this.getEnv('ADMIN_PASS') && {
      user: this.getEnv('ADMIN_USER') || 'admin',
      pass: this.getEnv('ADMIN_PASS')
    }

    if (this.features.debugAutoFund && !this.admin) {
      throw new Error('CONNECTOR_DEBUG_AUTOFUND requires CONNECTOR_ADMIN_PASS')
    }

    // Configure which backend we will use to determine
    // rates and execute payments
    this.backend = this.getEnv('BACKEND') || 'fixerio'

    this.expiry = {}
    this.expiry.minMessageWindow =
      this.getEnv('MIN_MESSAGE_WINDOW') || 1 // seconds
    this.expiry.maxHoldTime = this.getEnv('MAX_HOLD_TIME') || 10 // seconds
    this.expiry.feePercentage =
      this.getEnv('FEE_PERCENTAGE') || 0.01

    // The spread is added to every quoted rate
    this.fxSpread = Number(this.getEnv('FX_SPREAD')) || 0.002 // = .2%

    if (process.env.NODE_ENV === 'unit') {
      this.server.base_uri = 'http://localhost'
      this.ledgerCredentials = {
        'http://cad-ledger.example/CAD': {
          account_uri: 'http://cad-ledger.example/accounts/mark',
          username: 'mark',
          password: 'mark'
        },
        'http://usd-ledger.example/USD': {
          account_uri: 'http://usd-ledger.example/accounts/mark',
          username: 'mark',
          password: 'mark'
        },
        'http://eur-ledger.example/EUR': {
          account_uri: 'http://eur-ledger.example/accounts/mark',
          username: 'mark',
          password: 'mark'
        },
        'http://cny-ledger.example/CNY': {
          account_uri: 'http://cny-ledger.example/accounts/mark',
          username: 'mark',
          password: 'mark'
        }
      }
    }
  }

  generateDefaultPairs () {
    return Utils.getPairs(this.ledgers).map((pair) => {
      return pair.map(desc => desc.currency + '@' + desc.ledger)
    })
  }
}

module.exports = ConnectorConfig
