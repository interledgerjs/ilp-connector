'use strict'

const _ = require('lodash')
const EventEmitter = require('eventemitter2')
const compat = require('ilp-compat-plugin')
const PluginStore = require('../lib/pluginStore.js')
const TradingPairs = require('./trading-pairs')
const logger = require('../common/log')
const log = logger.create('accounts')
const { createIlpRejection, codes } = require('./ilp-errors')

const PLUGIN_EVENTS = [
  'connect',
  'disconnect',
  'incoming_transfer',
  'incoming_prepare',
  'outgoing_fulfill',
  'outgoing_cancel',
  'outgoing_reject'
]

class Accounts extends EventEmitter {
  constructor ({ config, routingTable }) {
    super()
    this.pluginList = [] // LedgerPlugin[]
    this.plugins = {} // { prefix ⇒ LedgerPlugin }
    this.prefixReverseMap = new Map() // { LedgerPlugin ⇒ prefix }
    this._config = config
    this._pairs = new TradingPairs()
    this._accounts = new Map()
    this.requestHandler = this._requestHandler.bind(this)
    this.createIlpRejection = createIlpRejection.bind(null, config.address)

    const accounts = this
    this._relayEvents = {}
    PLUGIN_EVENTS.forEach((event) => {
      this._relayEvents[event] = function () {
        const args = Array.prototype.slice.call(arguments)
        return accounts.emitAsync.apply(accounts, [event, this].concat(args))
      }
    })
  }

  connect (options) {
    return Promise.all(this.pluginList.map((plugin) => plugin.connect(options)))
  }

  getPlugin (accountAddress) {
    if (accountAddress.slice(-1) === '.') {
      throw new Error('peer address must not end with "."')
    }
    return this.plugins[accountAddress] || null
  }

  getPlugins () {
    return this.pluginList
  }

  getPrefixes () {
    return Object.keys(this.plugins)
  }

  getPairs () {
    return this._pairs.toArray()
  }

  setPairs (pairs) {
    this._pairs.empty()
    this._pairs.addPairs(pairs)
  }

  getCurrency (accountAddress) {
    const account = this._accounts.get(accountAddress)

    if (!account) {
      log.debug('no currency found. account=' + accountAddress)
      return null
    }

    return account.currency
  }

  add (accountAddress, creds, tradesTo, tradesFrom) {
    log.info('add account. peerAddress=' + accountAddress)

    creds = _.cloneDeep(creds)
    let store = null

    if (creds.store) {
      if (!this._config.databaseUri) {
        throw new Error('missing DB_URI; cannot create plugin store for ' + accountAddress)
      }
      store = new PluginStore(this._config.databaseUri, accountAddress)
    }

    creds.options.prefix = accountAddress
    const Plugin = require(creds.plugin)
    const plugin = compat(new Plugin(Object.assign({}, creds.options, {
      debugReplyNotifications: this._config.features.debugReplyNotifications,
      // non JSON-stringifiable fields are prefixed with an underscore
      _store: store,
      _log: logger.create(creds.plugin)
    })))
    if (creds.overrideInfo) {
      const _getInfo = plugin.getInfo.bind(plugin)
      plugin.getInfo = () => {
        const info = Object.assign({}, _getInfo(), creds.overrideInfo)
        log.debug('using overridden info for plugin', accountAddress, info)
        return info
      }
    }

    if (accountAddress.slice(-1) === '.') {
      throw new Error('peer address must not end with "."')
    }
    this.prefixReverseMap.set(plugin, accountAddress)
    this.pluginList.push(plugin)
    this.plugins[accountAddress] = plugin

    this._accounts.set(accountAddress, {
      currency: creds.currency,
      plugin
    })
    plugin.registerTransferHandler(this._handleTransfer.bind(this, accountAddress))
    plugin.registerRequestHandler(this.requestHandler)
  }

  remove (accountAddress) {
    const plugin = this.getPlugin(accountAddress)
    if (!plugin) {
      return
    }
    log.info('remove account. peerAddress=' + accountAddress)
    plugin.deregisterTransferHandler()
    this.pluginList.splice(this.pluginList.indexOf(plugin), 1)
    delete this.plugins[accountAddress]
    this.prefixReverseMap.delete(plugin)
    this._accounts.delete(accountAddress)
    return plugin
  }

  async _handleTransfer (prefix, transfer) {
    if (!this._transferHandler) {
      throw this.createIlpRejection({
        code: codes.F02_UNREACHABLE,
        message: 'Connector not ready'
      })
    }

    return this._transferHandler(prefix, transfer)
  }

  registerTransferHandler (transferHandler) {
    if (this._transferHandler) {
      throw new Error('Transfer handler already registered')
    }
    this._transferHandler = transferHandler
  }

  deregisterTransferHandler () {
    this._transferHandler = null
  }

  async _requestHandler (requestMessage) {
    if (this._externalRequestHandler) {
      const responseMessage = await this._externalRequestHandler(requestMessage)
      if (responseMessage) return responseMessage
    }
    if (this._internalRequestHandler) {
      const responseMessage = await this._internalRequestHandler(requestMessage)
      if (responseMessage) return responseMessage
    }
    throw new Error('Invalid request method')
  }

  registerInternalRequestHandler (requestHandler) {
    this._internalRequestHandler = requestHandler
  }

  registerExternalRequestHandler (requestHandler) {
    this._externalRequestHandler = requestHandler
  }

  getPrefix (plugin) {
    return this.prefixReverseMap.get(plugin)
  }

  isLocal (address) {
    for (let prefix of Object.keys(this.plugins)) {
      if (address.startsWith(prefix)) {
        return true
      }
    }
    return false
  }
}

module.exports = Accounts
