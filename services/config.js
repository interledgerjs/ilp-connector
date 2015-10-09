'use strict'

const url = require('url')

const config = exports

config.server = {}
config.server.secure = !!process.env.PUBLIC_HTTPS
config.server.bind_ip = process.env.BIND_IP || '0.0.0.0'
config.server.port = process.env.PORT || 4000
config.server.public_host = process.env.HOSTNAME || require('os').hostname()
config.server.public_port = process.env.PUBLIC_PORT || config.server.port

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
config.expiry.maxHoldTime = process.env.MAX_HOLD_TIME || 10 // seconds
config.expiry.feePercentage =
  process.env.FEE_PERCENTAGE || 0.01

const isCustomPort = config.server.secure
  ? +config.server.public_port !== 443
  : +config.server.public_port !== 80
config.server.base_uri = url.format({
  protocol: 'http' + (config.server.secure ? 's' : ''),
  hostname: config.server.public_host,
  port: isCustomPort ? config.server.public_port : undefined
})

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
