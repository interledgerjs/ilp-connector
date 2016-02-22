'use strict'

const fs = require('fs')
const Config = require('five-bells-shared').Config
const Utils = require('../lib/utils')
const _ = require('lodash')

const envPrefix = 'connector'

function isRunningTests () {
  return process.argv[0].endsWith('mocha') ||
    (process.argv.length > 1 && process.argv[0].endsWith('node') &&
     process.argv[1].endsWith('mocha'))
}

function useTestConfig () {
  return !Config.castBool(process.env.UNIT_TEST_OVERRIDE) && isRunningTests()
}

function generateDefaultPairs (ledgers) {
  return Utils.getPairs(ledgers).map((pair) => {
    return pair.map(desc => desc.currency + '@' + desc.ledger)
  })
}

function parseCredentialsEnv () {
  return JSON.parse(Config.getEnv(envPrefix, 'CREDENTIALS') || '{}')
}

function parseCredentials () {
  const credentialsEnv = parseCredentialsEnv()

  return _.reduce(credentialsEnv, (parsed, credentials, ledger) => {
    const isClientCertCredential = credentials.key !== undefined

    if (isClientCertCredential) {
      parsed[ledger] = _.assign(credentials, {
        key: fs.readFileSync(credentials.key),
        cert: fs.readFileSync(credentials.cert),
        ca: credentials.cert && fs.readFileSync(credentials.ca)
      })
    } else {
      parsed[ledger] = credentials
    }

    return parsed
  }, {})
}

function validateLocalEnvConfig () {
  const credentials = parseCredentialsEnv()

  _.forEach(credentials, (credential, ledger) => {
    if ((credential.username === undefined) !== (credential.password === undefined)) {
      throw new Error(`Missing username or password for ledger: ${ledger}`)
    } else if ((credential.cert === undefined) !== (credential.key === undefined)) {
      throw new Error(`Missing certificate or key for ledger: ${ledger}`)
    } else if (credential.account_uri === undefined) {
      throw new Error(`Missing account_uri for ledger: ${ledger}`)
    }

    try {
      credential.cert && fs.accessSync(credential.cert)
      credential.key && fs.accessSync(credential.key)
      credential.ca && fs.accessSync(credential.ca)
    } catch (e) {
      throw new Error(`Failed to read credentials for ${ledger}: ${e.message}`)
    }
  })
}

function getLocalConfig () {
  validateLocalEnvConfig()

  // List of ledgers this connector has accounts on (used to auto-generate pairs)
  // e.g. ["USD@http://usd-ledger.example","EUR@http://eur-ledger.example/some/path"]
  const ledgers = JSON.parse(Config.getEnv(envPrefix, 'LEDGERS') || '[]').map(ledger => {
    const sep = ledger.indexOf('@')
    return { currency: ledger.substr(0, sep), ledger: ledger.substr(sep + 1) }
  })

  // Currency pairs traded should be specified as
  // [["USD@http://usd-ledger.example/USD","EUR@http://eur-ledger.example"],...]
  let tradingPairs =
    JSON.parse(Config.getEnv(envPrefix, 'PAIRS') || 'false') || generateDefaultPairs(ledgers)

  const features = {}
  features.debugAutoFund = Config.castBool(Config.getEnv(envPrefix, 'DEBUG_AUTOFUND'))

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
  let ledgerCredentials = {}
  let server = {}

  if (useTestConfig()) {
    server.base_uri = 'http://localhost'
    ledgerCredentials = require('../../test/data/ledgerCredentials.json')
    if (!tradingPairs.length) {
      tradingPairs = require('../../test/data/tradingPairs.json')
    }
  } else {
    ledgerCredentials = parseCredentials()
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
