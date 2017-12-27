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
  constructor () {
    this.getLocalConfig()
  }

  validateAccount (address, accountInfo) {
    if (typeof accountInfo.currency !== 'string') {
      log.error('currency not specified. account=%s', address)
      return false
    }

    if (typeof accountInfo.currencyScale !== 'number') {
      log.error('currency scale not specified. account=%s', address)
      return false
    }

    if (typeof accountInfo.plugin !== 'string') {
      log.error('plugin module not specified. account=%s', address)
      return false
    }

    if (typeof accountInfo.options !== 'object') {
      log.error('plugin options not specified. account=%s', address)
      return false
    }

    if (accountInfo.store && typeof accountInfo.store !== 'boolean') {
      log.error('plugin store should be either true or false. account=%s', address)
      return false
    }

    return true
  }

  validate () {
    if (!this.address) {
      log.error('please set required config setting CONNECTOR_ILP_ADDRESS.')
      return false
    }

    for (let k of Object.keys(this.accountCredentials)) {
      const accountInfo = this.accountCredentials[k]
      if (!this.validateAccount(k, accountInfo)) {
        return false
      }
    }

    return true
  }

  get (key) {
    return this[key]
  }

  /**
   * Parse a boolean config variable.
   *
   * Environment variables are passed in as strings, but this function can turn
   * values like `undefined`, `''`, `'0'` and `'false'` into `false`.
   *
   * If a default value is provided, `undefined` and `''` will return the
   * default value.
   *
   * Values other than `undefined`, `''`, `'1'`, `'0'`, `'true'`, and `'false'` will throw.
   *
   * @param {String} value Config value
   * @param {Boolean} defaultValue Value to be returned for undefined or empty inputs
   * @return {Boolean} Same config value intelligently cast to bool
   */
  static castBool (value, defaultValue) {
    value = value && value.trim()
    if (value === undefined || value === '') return Boolean(defaultValue)
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false
    throw new TypeError('castBool unexpected value: ' + value)
  }

  /**
   * Get a config value from the environment.
   *
   * Applies the config prefix defined in the constructor.
   *
   *
   * @param {String} prefix prefix
   * @param {String} name Config key (will be prefixed)
   * @return {String} Config value or undefined
   *
   * getEnv('example', 'my_setting') === process.env.EXAMPLE_MY_SETTING
   */
  static getEnv (prefix, name) {
    let envVar
    if (name && prefix) envVar = `${prefix}_${name}`
    else if (name && !prefix) envVar = name
    else if (!name && prefix) envVar = prefix
    else throw new TypeError('Invalid environment variable')

    return process.env[envVar.toUpperCase().replace(/-/g, '_')]
  }

  generateDefaultPairs (accounts) {
    return Utils.getPairs(accounts).map((pair) => {
      return pair.map((desc) => desc.ledger)
    })
  }

  parseCredentials () {
    const credentialsEnv = this.parseCredentialsEnv()

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

    return JSON.parse(Config.getEnv(envPrefix, 'ACCOUNTS') || '{}')
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
    // Routes to add to the connector, in the form:
    // [{
    //  "targetPrefix": "", // match any route
    //  "peerAddress": "ilpdemo.red."
    // }, {
    //  "targetPrefix": "usd.",
    //  "peerAddress": "example.other."
    // }]
    this.routes = this.parseRoutes()

    const features = this.features = {}
    // Debug feature: Reply to websocket notifications
    features.debugReplyNotifications =
    Config.castBool(Config.getEnv(envPrefix, 'DEBUG_REPLY_NOTIFICATIONS'))

    this.address = Config.getEnv(envPrefix, 'ILP_ADDRESS') || ''

    // Configure which backend we will use to determine
    // rates and execute payments. The list of available backends
    // can be found in src/backends
    this.backend = Config.getEnv(envPrefix, 'BACKEND') || 'fixerio'

    const expiry = this.expiry = {}
    expiry.minMessageWindow =
    +Config.getEnv(envPrefix, 'MIN_MESSAGE_WINDOW') || DEFAULT_MIN_MESSAGE_WINDOW

    if (expiry.minMessageWindow < 1) {
      log.warn('CONNECTOR_MIN_MESSAGE_WINDOW is less than the recommended value of 1 second. ' +
      'Short message windows increase the likelihood that the connector will be unable ' +
      'to fulfill incoming transfers before their expiries, resulting in a loss of funds. ' +
      'For more information on this risk, see the Interledger whitepaper')
    }

    expiry.maxHoldTime = +Config.getEnv(envPrefix, 'MAX_HOLD_TIME') || DEFAULT_MAX_HOLD_TIME

    this.databaseUri = Config.getEnv(envPrefix, 'DB_URI')

    // The spread is added to every quoted rate
    const fxSpreadString = Config.getEnv(envPrefix, 'FX_SPREAD')
    this.fxSpread = fxSpreadString ? +fxSpreadString : DEFAULT_FX_SPREAD

    const slippageString = Config.getEnv(envPrefix, 'SLIPPAGE')
    this.slippage = slippageString ? +slippageString : DEFAULT_SLIPPAGE

    // BACKEND_URI must be defined for backends that connect to an external
    // component to retrieve the rate or amounts (it is therefore required
    // when using the ilp-quote backend)
    this.backendUri = Config.getEnv(envPrefix, 'BACKEND_URI')

    const routeBroadcastEnabledString = Config.getEnv(envPrefix, 'ROUTE_BROADCAST_ENABLED')
    this.routeBroadcastEnabled =
    routeBroadcastEnabledString ? Config.castBool(routeBroadcastEnabledString) : true

    // For a 'core' node in an open network, set both to true.
    // For a 'periphery' node in an open network, set only the first one to true.
    // For a node in a network where price competition between routes is not needed, set both to false.
    const broadcastCurvesString = Config.getEnv(envPrefix, 'BROADCAST_CURVES')
    this.broadcastCurves =
    broadcastCurvesString ? Config.castBool(broadcastCurvesString) : true
    const storeCurvesString = Config.getEnv(envPrefix, 'STORE_CURVES')
    this.storeCurves =
    storeCurvesString ? Config.castBool(storeCurvesString) : true
    const reflectPaymentsString = Config.getEnv(envPrefix, 'REFLECT_PAYMENTS')
    this.reflectPayments =
    reflectPaymentsString ? Config.castBool(reflectPaymentsString) : true

    this.routeBroadcastInterval =
    Number(Config.getEnv(envPrefix, 'ROUTE_BROADCAST_INTERVAL')) || DEFAULT_ROUTE_BROADCAST_INTERVAL
    this.routeCleanupInterval =
    Number(Config.getEnv(envPrefix, 'ROUTE_CLEANUP_INTERVAL')) || DEFAULT_ROUTE_CLEANUP_INTERVAL
    this.routeExpiry =
    Number(Config.getEnv(envPrefix, 'ROUTE_EXPIRY')) || DEFAULT_ROUTE_EXPIRY
    this.quoteExpiry =
    Number(Config.getEnv(envPrefix, 'QUOTE_EXPIRY')) || DEFAULT_QUOTE_EXPIRY

    const peersString = Config.getEnv(envPrefix, 'PEERS')
    this.peers = peersString ? peersString.split(',') : []

    // Credentials should be specified as a map of the form
    // {
    //    "<ledger_uri>": {
    //      "account": "...",
    //      "username": "...",
    //      "password": "..."
    //    }
    // }
    this.accountCredentials = this.parseCredentials()

    // The secret is used to generate destination transfer IDs
    // that cannot be guessed and squatted on by others
    const secretString = Config.getEnv(envPrefix, 'SECRET')
    this.secret = secretString
      ? Buffer.from(secretString, 'base64')
      : crypto.randomBytes(32)
  }
}

module.exports = Config
