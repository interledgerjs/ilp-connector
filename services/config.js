'use strict'

const Config = require('@ripple/five-bells-shared').Config

const config = module.exports = new Config('trader')

config.parseServerConfig()

// Currency pairs traded should be specified as
// [["USD@http://usd-ledger.example/USD","EUR@http://eur-ledger.example"],...]
config.tradingPairs = JSON.parse(process.env.TRADING_PAIRS || '[]')

// Credentials should be specified as a map of the form
// {
//    "<ledger_uri>": {
//      "account_uri": "...",
//      "username": "...",
//      "password": "..."
//    }
// }
config.ledgerCredentials = JSON.parse(process.env.TRADER_CREDENTIALS || '{}')

// TODO: make sure the tradingPairs include only ledgers we have credentials for

config.features = {}
config.features.debugAutoFund = !!process.env.TRADER_DEBUG_AUTOFUND

// Configure which backend we will use to determine
// rates and execute payments
config.backend = process.env.TRADER_BACKEND || 'fixerio'

config.expiry = {}
config.expiry.minMessageWindow =
  process.env.MIN_MESSAGE_WINDOW || 1 // seconds
config.expiry.maxHoldTime = process.env.TRADER_MAX_HOLD_TIME || 10 // seconds
config.expiry.feePercentage =
  process.env.FEE_PERCENTAGE || 0.01

if (process.env.NODE_ENV === 'unit') {
  config.server.base_uri = 'http://localhost'
  config.ledgerCredentials = {
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
