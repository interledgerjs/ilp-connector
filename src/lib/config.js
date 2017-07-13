'use strict'

const fs = require('fs')
const Config = require('five-bells-shared').Config
const Utils = require('../lib/utils')
const _ = require('lodash')
const logger = require('../common/log')
const log = logger.create('config')
const crypto = require('crypto')

const envPrefix = 'CONNECTOR'

const DEFAULT_MIN_MESSAGE_WINDOW = 1 // seconds
const DEFAULT_MAX_HOLD_TIME = 10 // seconds
const DEFAULT_FX_SPREAD = 0.002 // 0.2%
const DEFAULT_SLIPPAGE = 0.001 // 0.1%

const DEFAULT_ROUTE_BROADCAST_INTERVAL = 30 * 1000 // milliseconds
const DEFAULT_ROUTE_CLEANUP_INTERVAL = 1000 // milliseconds
const DEFAULT_ROUTE_EXPIRY = 45 * 1000 // milliseconds
const DEFAULT_QUOTE_EXPIRY = 45 * 1000 // milliseconds

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
    } if (ledger.store && typeof ledger.store !== 'boolean') {
      console.error('plugin store should be either true or false on "' + k + '"')
    }

    ret[k] = {
      currency: ledger.currency,
      store: ledger.store,
      plugin: ledger.plugin,
      overrideInfo: ledger.overrideInfo,
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

function parseRoutes () {
  const routes = JSON.parse(Config.getEnv(envPrefix, 'ROUTES') || '[]')

  for (let route of routes) {
    if (
      typeof route.connectorLedger !== 'string' ||
      typeof route.connectorAccount !== 'string' ||
      !route.connectorLedger.match(/^[a-zA-Z0-9._~-]+\.$/) ||
      !route.connectorAccount.startsWith(route.connectorLedger) ||
      typeof route.targetPrefix !== 'string'
    ) {
      throw new Error('invalid format for CONNECTOR_ROUTES: ' +
        JSON.stringify(route))
    }
  }

  return routes
}

function getLocalConfig () {
  const ledgers = parseLedgers()
  // Currency pairs traded should be specified as
  // [["USD@http://usd-ledger.example","EUR@http://eur-ledger.example"],...]
  let tradingPairs =
    JSON.parse(Config.getEnv(envPrefix, 'PAIRS') || 'false') || generateDefaultPairs(ledgers)

  // Routes to add to the connector, in the form:
  // [{
  //  "targetPrefix": "", // match any route
  //  "connectorLedger": "ilpdemo.red."
  //  "connectorAccount": "ilpdemo.red.connie"
  // }, {
  //  "targetPrefix": "usd.",
  //  "connectorLedger": "example.other."
  //  "connectorAccount": "example.other.connector"
  // }]
  const configRoutes = parseRoutes()

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

  if (expiry.minMessageWindow < 1) {
    log.warn('CONNECTOR_MIN_MESSAGE_WINDOW is less than the recommended value of 1 second. ' +
      'Short message windows increase the likelihood that the connector will be unable ' +
      'to fulfill incoming transfers before their expiries, resulting in a loss of funds. ' +
      'For more information on this risk, see the Interledger whitepaper')
  }

  expiry.maxHoldTime = +Config.getEnv(envPrefix, 'MAX_HOLD_TIME') || DEFAULT_MAX_HOLD_TIME

  const databaseUri = Config.getEnv('DB_URI')

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

  // For a 'core' node in an open network, set both to true.
  // For a 'periphery' node in an open network, set only the first one to true.
  // For a node in a network where price competition between routes is not needed, set both to false.
  const broadcastCurvesString = Config.getEnv(envPrefix, 'BROADCAST_CURVES')
  const broadcastCurves =
    broadcastCurvesString ? Config.castBool(broadcastCurvesString) : true
  const storeCurvesString = Config.getEnv(envPrefix, 'STORE_CURVES')
  const storeCurves =
    storeCurvesString ? Config.castBool(storeCurvesString) : true

  const routeBroadcastInterval =
    Number(Config.getEnv(envPrefix, 'ROUTE_BROADCAST_INTERVAL')) || DEFAULT_ROUTE_BROADCAST_INTERVAL
  const routeCleanupInterval =
    Number(Config.getEnv(envPrefix, 'ROUTE_CLEANUP_INTERVAL')) || DEFAULT_ROUTE_CLEANUP_INTERVAL
  const routeExpiry =
    Number(Config.getEnv(envPrefix, 'ROUTE_EXPIRY')) || DEFAULT_ROUTE_EXPIRY
  const quoteExpiry =
    Number(Config.getEnv(envPrefix, 'QUOTE_EXPIRY')) || DEFAULT_QUOTE_EXPIRY

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
  const ledgerCredentials = parseCredentials()

  // The secret is used to generate destination transfer IDs
  // that cannot be guessed and squatted on by others
  const secretString = Config.getEnv(envPrefix, 'SECRET')
  const secret = secretString
    ? Buffer.from(secretString, 'base64')
    : crypto.randomBytes(32)
  const unwiseUseSameTransferId = Config.castBool(Config.getEnv(envPrefix, 'UNWISE_USE_SAME_TRANSFER_ID'))

  return {
    backend,
    configRoutes,
    ledgerCredentials,
    fxSpread,
    slippage,
    expiry,
    features,
    tradingPairs,
    backendUri,
    routeBroadcastEnabled,
    routeBroadcastInterval,
    routeCleanupInterval,
    routeExpiry,
    broadcastCurves,
    storeCurves,
    quoteExpiry,
    autoloadPeers,
    peers,
    databaseUri,
    secret,
    unwiseUseSameTransferId
  }
}

function loadConnectorConfig () {
  return Config.loadConfig(envPrefix, getLocalConfig(), {ed25519: false})
}

module.exports = loadConnectorConfig
