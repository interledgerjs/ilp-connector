'use strict'

const fs = require('fs')
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

class Config {
  validate () {
    if (!this.address) {
      log.error('please set required config setting CONNECTOR_ILP_ADDRESS.')
      process.exit(1)
    }
  }

  generateDefaultPairs (accounts) {
    return Utils.getPairs(accounts).map((pair) => {
      return pair.map((desc) => desc.ledger)
    })
  }

  parseCredentials () {
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

  parseCredentialsEnv () {
    if (Config.getEnv(envPrefix, 'LEDGERS')) {
      log.error('You set CONNECTOR_LEDGERS, which is a deprecated configuration variable. Please migrate to CONNECTOR_ACCOUNTS.')
      process.exit(1)
    }

    const accounts = JSON.parse(Config.getEnv(envPrefix, 'ACCOUNTS') || '{}')
    const ret = {}

    Object.keys(accounts).forEach((k) => {
      const ledger = accounts[k]

      if (typeof ledger.currency !== 'string') {
        console.error('currency not specified on "' + k + '"')
      }

      if (typeof ledger.plugin !== 'string') {
        console.error('plugin module not specified on "' + k + '"')
      }

      if (typeof ledger.options !== 'object') {
        console.error('plugin options not specified on "' + k + '"')
      }

      if (ledger.store && typeof ledger.store !== 'boolean') {
        console.error('plugin store should be either true or false on "' + k + '"')
      }

      ret[k] = {
        currency: ledger.currency,
        store: ledger.store,
        plugin: ledger.plugin,
        overrideInfo: ledger.overrideInfo,
        options: ledger.options
      }
    })

    return ret
  }

  parseAccounts () {
    // List of accounts this connector has accounts on (used to auto-generate pairs)
    // e.g. {
    //    "example.usd.ledger": {
    //      "currency": "USD",
    //      "plugin": 'ilp-plugin-example',
    //      "options": {
    //        // plugin options ...
    //      }
    //    },
    //    "example.eur.ledger": {
    //      "currency": "EUR",
    //      "plugin": 'ilp-plugin-example',
    //      "options": {
    //        // plugin options ...
    //      }
    //    }
    //  }
    const accounts = JSON.parse(Config.getEnv(envPrefix, 'ACCOUNTS') || '{}')
    return Object.keys(accounts).map((ledger) => {
      return { currency: accounts[ledger].currency, ledger }
    })
  }

  parseRoutes () {
    const routes = JSON.parse(Config.getEnv(envPrefix, 'ROUTES') || '[]')

    for (let route of routes) {
      if (
        typeof route.peerAddress !== 'string' ||
        !route.peerAddress.match(/^[a-zA-Z0-9._~-]+$/) ||
        typeof route.targetPrefix !== 'string' ||
        !route.peerAddress.match(/^[a-zA-Z0-9._~-]*$/)
      ) {
        throw new Error('invalid format for CONNECTOR_ROUTES. value=' +
        JSON.stringify(route))
      }
    }

    return routes
  }

  getLocalConfig () {
    const accounts = parseAccounts()
    // Currency pairs traded should be specified as
    // [["http://usd-ledger.example","http://eur-ledger.example"],...]
    let tradingPairs =
    JSON.parse(Config.getEnv(envPrefix, 'PAIRS') || 'false') || generateDefaultPairs(accounts)

    // Routes to add to the connector, in the form:
    // [{
    //  "targetPrefix": "", // match any route
    //  "peerAddress": "ilpdemo.red."
    // }, {
    //  "targetPrefix": "usd.",
    //  "peerAddress": "example.other."
    // }]
    const routes = parseRoutes()

    const features = {}
    // Debug feature: Reply to websocket notifications
    features.debugReplyNotifications =
    Config.castBool(Config.getEnv(envPrefix, 'DEBUG_REPLY_NOTIFICATIONS'))

    const address = Config.getEnv(envPrefix, 'ILP_ADDRESS') || ''

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
    const reflectPaymentsString = Config.getEnv(envPrefix, 'REFLECT_PAYMENTS')
    const reflectPayments =
    reflectPaymentsString ? Config.castBool(reflectPaymentsString) : true

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

    // Credentials should be specified as a map of the form
    // {
    //    "<ledger_uri>": {
    //      "account": "...",
    //      "username": "...",
    //      "password": "..."
    //    }
    // }
    const accountCredentials = parseCredentials()

    // The secret is used to generate destination transfer IDs
    // that cannot be guessed and squatted on by others
    const secretString = Config.getEnv(envPrefix, 'SECRET')
    const secret = secretString
    ? Buffer.from(secretString, 'base64')
    : crypto.randomBytes(32)
}

  return {
    validate,

    address,
    backend,
    routes,
    accountCredentials,
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
    reflectPayments,
    quoteExpiry,
    peers,
    databaseUri,
    secret
  }
}

function loadConnectorConfig () {
  return Config.loadConfig(envPrefix, getLocalConfig(), {ed25519: false})
}

module.exports = loadConnectorConfig
