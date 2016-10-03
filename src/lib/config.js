'use strict'

const fs = require('fs')
const Config = require('five-bells-shared').Config
const Utils = require('../lib/utils')
const _ = require('lodash')

const envPrefix = 'CONNECTOR'

const DEFAULT_MIN_MESSAGE_WINDOW = 1 // seconds
const DEFAULT_MAX_HOLD_TIME = 10 // seconds
const DEFAULT_FX_SPREAD = 0.002 // 0.2%
const DEFAULT_SLIPPAGE = 0.001 // 0.1%

const DEFAULT_ROUTE_BROADCAST_INTERVAL = 30 * 1000 // milliseconds
const DEFAULT_ROUTE_CLEANUP_INTERVAL = 1000 // milliseconds
const DEFAULT_ROUTE_EXPIRY = 45 * 1000 // milliseconds

function isRunningTests () {
  return (
    process.env.NODE_ENV === 'unit' ||
    process.argv[0].endsWith('mocha') ||
    (process.argv.length > 1 && process.argv[0].endsWith('node') &&
     process.argv[1].endsWith('mocha'))
   )
}

function useTestConfig () {
  return !Config.castBool(process.env.UNIT_TEST_OVERRIDE) && isRunningTests()
}

function generateDefaultPairs (ledgers) {
  return Utils.getPairs(ledgers).map((pair) => {
    return pair.map((desc) => desc.currency + '@' + desc.ledger)
  })
}

function parseCredentials () {
  const credentialsEnv = parseCredentialsEnv()

  return _.mapValues(credentialsEnv, (credentials) => {
    // DEPRECATED: `account_uri` (should be just `account`)
    if (credentials.account_uri) {
      console.error('DEPRECATED: The key `account_uri` in ledger credentials has been renamed `account`')
      credentials.account = credentials.account_uri
      delete credentials.account_uri
    }

    // Apply default ledger type
    if (!credentials.options.type) {
      credentials.options.type = 'bells'
    }

    const isClientCertCredential = credentials.key !== undefined

    if (isClientCertCredential) {
      return _.omitBy(_.assign(credentials, {
        key: fs.readFileSync(credentials.key),
        cert: fs.readFileSync(credentials.cert),
        ca: credentials.ca && fs.readFileSync(credentials.ca)
      }), _.isUndefined)
    }

    return _.omitBy(_.assign(credentials, {
      ca: credentials.ca && fs.readFileSync(credentials.ca)
    }), _.isUndefined)
  })
}

function parseCredentialsEnv () {
  // use the CONNECTOR_LEDGERS object instead of separate CREDENTIALS
  const ret = {}
  const ledgers = JSON.parse(Config.getEnv(envPrefix, 'LEDGERS') || '{}')

  Object.keys(ledgers).forEach((k) => {
    const ledger = ledgers[k]

    if (typeof ledger.currency !== 'string') {
      console.error('currency not specified on "' + k + '"')
    } if (typeof ledger.plugin !== 'string') {
      console.error('plugin module not specified on "' + k + '"')
    } if (typeof ledger.options !== 'object') {
      console.error('plugin options not specified on "' + k + '"')
    }

    ret[k] = {
      currency: ledger.currency,
      plugin: ledger.plugin,
      options: Object.assign({}, ledger.options)
    }
  })
  return ret
}

function parseLedgers () {
  // List of ledgers this connector has accounts on (used to auto-generate pairs)
  // e.g. {
  //    "http://usd-ledger.example": {
  //      "currency": "USD",
  //      "plugin": 'ilp-plugin-example',
  //      "options": {
  //        // plugin options ...
  //      }
  //    },
  //    "http://eur-ledger.example/some/path": {
  //      "currency": "EUR",
  //      "plugin": 'ilp-plugin-example',
  //      "options": {
  //        // plugin options ...
  //      }
  //    }
  //  }
  const ledgers = JSON.parse(Config.getEnv(envPrefix, 'LEDGERS') || '{}')
  return Object.keys(ledgers).map((ledger) => {
    return { currency: ledgers[ledger].currency, ledger }
  })
}

function getLogLevel () {
  if (useTestConfig()) {
    return 'debug'
  } else {
    // https://github.com/trentm/node-bunyan#levels
    return Config.getEnv(envPrefix, 'LOG_LEVEL') || 'info'
  }
}

function getLocalConfig () {
  const ledgers = parseLedgers()
  // Currency pairs traded should be specified as
  // [["USD@http://usd-ledger.example","EUR@http://eur-ledger.example"],...]
  let tradingPairs =
    JSON.parse(Config.getEnv(envPrefix, 'PAIRS') || 'false') || generateDefaultPairs(ledgers)

  const features = {}
  // Debug feature: Reply to websocket notifications
  features.debugReplyNotifications =
    Config.castBool(Config.getEnv(envPrefix, 'DEBUG_REPLY_NOTIFICATIONS'))

  // Configure which backend we will use to determine
  // rates and execute payments. The list of available backends
  // can be found in src/backends
  const backend = Config.getEnv(envPrefix, 'BACKEND') || 'fixerio'

  const expiry = {}
  expiry.minMessageWindow =
    +Config.getEnv(envPrefix, 'MIN_MESSAGE_WINDOW') || DEFAULT_MIN_MESSAGE_WINDOW
  expiry.maxHoldTime = +Config.getEnv(envPrefix, 'MAX_HOLD_TIME') || DEFAULT_MAX_HOLD_TIME

  // The spread is added to every quoted rate
  const fxSpreadString = Config.getEnv(envPrefix, 'FX_SPREAD')
  const fxSpread = fxSpreadString ? +fxSpreadString : DEFAULT_FX_SPREAD

  const slippageString = Config.getEnv(envPrefix, 'SLIPPAGE')
  const slippage = slippageString ? +slippageString : DEFAULT_SLIPPAGE

  // BACKEND_URI must be defined for backends that connect to an external
  // component to retrieve the rate or amounts (it is therefore required
  // when using the ilp-quote backend)
  const backendUri = Config.getEnv(envPrefix, 'BACKEND_URI')

  const routeBroadcastEnabledString = Config.getEnv(envPrefix, 'ROUTE_BROADCAST_ENABLED')
  const routeBroadcastEnabled =
    routeBroadcastEnabledString ? Config.castBool(routeBroadcastEnabledString) : true
  const routeBroadcastInterval =
    Number(Config.getEnv(envPrefix, 'ROUTE_BROADCAST_INTERVAL')) || DEFAULT_ROUTE_BROADCAST_INTERVAL
  const routeCleanupInterval =
    Number(Config.getEnv(envPrefix, 'ROUTE_CLEANUP_INTERVAL')) || DEFAULT_ROUTE_CLEANUP_INTERVAL
  const routeExpiry =
    Number(Config.getEnv(envPrefix, 'ROUTE_EXPIRY')) || DEFAULT_ROUTE_EXPIRY

  const peersString = Config.getEnv(envPrefix, 'PEERS')
  const peers = peersString ? peersString.split(',') : []
  const autoloadPeers = Config.castBool(Config.getEnv(envPrefix, 'AUTOLOAD_PEERS'), false)

  // Credentials should be specified as a map of the form
  // {
  //    "<ledger_uri>": {
  //      "account": "...",
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
    features.debugReplyNotifications = true
  } else {
    ledgerCredentials = parseCredentials()
  }

  const logLevel = getLogLevel()

  return {
    backend,
    ledgerCredentials,
    fxSpread,
    slippage,
    expiry,
    features,
    tradingPairs,
    server,
    backendUri,
    routeBroadcastEnabled,
    routeBroadcastInterval,
    routeCleanupInterval,
    routeExpiry,
    autoloadPeers,
    peers,
    logLevel
  }
}

function loadConnectorConfig () {
  return Config.loadConfig(envPrefix, getLocalConfig(), {ed25519: false})
}

module.exports = loadConnectorConfig
