'use strict'

const Config = require('five-bells-shared').Config
const Utils = require('../lib/utils')

const envPrefix = 'connector'

function isRunningTests () {
  return process.argv[0].endsWith('mocha') ||
    (process.argv.length > 1 && process.argv[0].endsWith('node') &&
     process.argv[1].endsWith('mocha'))
}

function generateDefaultPairs (ledgers) {
  return Utils.getPairs(ledgers).map((pair) => {
    return pair.map(desc => desc.currency + '@' + desc.ledger)
  })
}

function getLocalConfig () {
  // List of ledgers this connector has accounts on (used to auto-generate pairs)
  // e.g. ["USD@http://usd-ledger.example","EUR@http://eur-ledger.example/some/path"]
  const ledgers = JSON.parse(Config.getEnv(envPrefix, 'LEDGERS') || '[]').map(ledger => {
    const sep = ledger.indexOf('@')
    return { currency: ledger.substr(0, sep), ledger: ledger.substr(sep + 1) }
  })

  // Currency pairs traded should be specified as
  // [["USD@http://usd-ledger.example/USD","EUR@http://eur-ledger.example"],...]
  const tradingPairs =
    JSON.parse(Config.getEnv(envPrefix, 'PAIRS') || 'false') || generateDefaultPairs(ledgers)

  const features = {}
  features.debugAutoFund = Config.castBool(Config.getEnv('DEBUG_AUTOFUND'))

  const admin = Config.getEnv(envPrefix, 'ADMIN_PASS') && {
    user: Config.getEnv(envPrefix, 'ADMIN_USER') || 'admin',
    pass: Config.getEnv(envPrefix, 'ADMIN_PASS')
  }

  if (features.debugAutoFund && !admin) {
    throw new Error('CONNECTOR_DEBUG_AUTOFUND requires CONNECTOR_ADMIN_PASS')
  }

  // Configure which backend we will use to determine
  // rates and execute payments
  const backend = Config.getEnv(envPrefix, 'BACKEND') || 'fixerio'

  const expiry = {}
  expiry.minMessageWindow =
    Config.getEnv(envPrefix, 'MIN_MESSAGE_WINDOW') || 1 // seconds
  expiry.maxHoldTime = Config.getEnv(envPrefix, 'MAX_HOLD_TIME') || 10 // seconds
  expiry.feePercentage =
    Config.getEnv(envPrefix, 'FEE_PERCENTAGE') || 0.01

  // The spread is added to every quoted rate
  const fxSpread = Number(Config.getEnv(envPrefix, 'FX_SPREAD')) || 0.002 // = .2%

  // Credentials should be specified as a map of the form
  // {
  //    "<ledger_uri>": {
  //      "account_uri": "...",
  //      "username": "...",
  //      "password": "..."
  //    }
  // }
  let ledgerCredentials = JSON.parse(Config.getEnv('CREDENTIALS') || '{}')

  let server = {}
  if (isRunningTests) {
    server.base_uri = 'http://localhost'
    ledgerCredentials = {
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

  return {
    backend,
    ledgerCredentials,
    fxSpread,
    expiry,
    features,
    admin,
    tradingPairs,
    server
  }
}

function loadConnectorConfig () {
  return Config.loadConfig(envPrefix, getLocalConfig())
}

module.exports = loadConnectorConfig
