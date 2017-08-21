'use strict'

const _ = require('lodash')
const co = require('co')
const EventEmitter = require('eventemitter2')
const PluginStore = require('../lib/pluginStore.js')
const TradingPairs = require('./trading-pairs')
const logger = require('../common/log')
const log = logger.create('ledgers')

const PLUGIN_EVENTS = [
  'connect',
  'disconnect',
  'incoming_transfer',
  'incoming_prepare',
  'outgoing_fulfill',
  'outgoing_cancel',
  'outgoing_reject'
]

class Ledgers extends EventEmitter {
  constructor ({ config, routingTables }) {
    super()
    this.pluginList = [] // LedgerPlugin[]
    this.plugins = {} // { prefix ⇒ LedgerPlugin }
    this.tables = routingTables
    this._config = config
    this._pairs = new TradingPairs()
    this._ledgers = new Map()
    this.requestHandler = co.wrap(this._requestHandler.bind(this))

    const ledgers = this
    this._relayEvents = {}
    PLUGIN_EVENTS.forEach((event) => {
      this._relayEvents[event] = function () {
        const args = Array.prototype.slice.call(arguments)
        return ledgers.emitAsync.apply(ledgers, [event, this].concat(args))
      }
    })
  }

  addFromCredentialsConfig (ledgerCredentials) {
    for (let ledgerPrefix of Object.keys(ledgerCredentials)) {
      this.add(ledgerPrefix, ledgerCredentials[ledgerPrefix])
    }
  }

  connect (options) {
    return Promise.all(this.pluginList.map((plugin) => plugin.connect(options)))
  }

  getPlugin (ledgerPrefix) {
    if (ledgerPrefix.slice(-1) !== '.') {
      throw new Error('prefix must end with "."')
    }
    return this.plugins[ledgerPrefix] || null
  }

  getPlugins (ledgerPrefix) { return this.pluginList }

  getPairs () {
    return this._pairs.toArray()
  }

  setPairs (pairs) {
    this._pairs.empty()
    this._pairs.addPairs(pairs)
  }

  getCurrencyForLedger (ledgerPrefix) {
    const ledger = this._ledgers.get(ledgerPrefix)

    if (!ledger) {
      return null
    }

    return ledger.currency
  }

  add (ledgerPrefix, creds, tradesTo, tradesFrom) {
    log.info('adding ledger ' + ledgerPrefix)

    creds = _.cloneDeep(creds)
    let store = null

    if (creds.store) {
      if (!this._config.databaseUri) {
        throw new Error('missing DB_URI; cannot create plugin store for ' + ledgerPrefix)
      }
      store = new PluginStore(this._config.databaseUri, ledgerPrefix)
    }

    creds.options.prefix = ledgerPrefix
    const Plugin = require(creds.plugin)
    const plugin = new Plugin(Object.assign({}, creds.options, {
      debugReplyNotifications: this._config.features.debugReplyNotifications,
      // non JSON-stringifiable fields are prefixed with an underscore
      _store: store,
      _log: logger.create(creds.plugin)
    }))
    if (creds.overrideInfo) {
      const _getInfo = plugin.getInfo.bind(plugin)
      plugin.getInfo = () => {
        const info = Object.assign({}, _getInfo(), creds.overrideInfo)
        log.debug('using overridden info for plugin', ledgerPrefix, info)
        return info
      }
    }
    this.addPlugin(ledgerPrefix, plugin)
    this._ledgers.set(ledgerPrefix, {
      currency: creds.currency,
      plugin
    })
    plugin.registerRequestHandler(this.requestHandler)

    if (tradesTo) {
      this._pairs.addPairs(tradesTo.map((e) => [creds.currency + '@' + ledgerPrefix, e]))
    }

    if (tradesFrom) {
      this._pairs.addPairs(tradesTo.map((e) => [e, creds.currency + '@' + ledgerPrefix]))
    }

    if (!tradesFrom && !tradesTo) {
      const newLedger = creds.currency + '@' + ledgerPrefix
      for (let otherLedgerPrefix of this._ledgers.keys()) {
        if (ledgerPrefix === otherLedgerPrefix) continue
        const currency = this._ledgers.get(otherLedgerPrefix).currency
        const otherLedger = currency + '@' + otherLedgerPrefix
        this._pairs.add(newLedger, otherLedger)
        this._pairs.add(otherLedger, newLedger)
      }
    }
  }

  remove (ledgerPrefix) {
    const plugin = this.getPlugin(ledgerPrefix)
    this._pairs.removeAll(this.getCurrencyForLedger(ledgerPrefix) + '@' + ledgerPrefix)
    this.removePlugin(ledgerPrefix)
    this._ledgers.delete(ledgerPrefix)
    return plugin
  }

  * _requestHandler (requestMessage) {
    if (this._externalRequestHandler) {
      const responseMessage = yield this._externalRequestHandler(requestMessage)
      if (responseMessage) return responseMessage
    }
    if (this._internalRequestHandler) {
      const responseMessage = yield this._internalRequestHandler(requestMessage)
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

  /**
   * @param {IlpAddress} prefix
   * @param {LedgerPlugin} plugin
   */
  addPlugin (prefix, plugin) {
    if (prefix.slice(-1) !== '.') {
      throw new Error('prefix must end with "."')
    }
    PLUGIN_EVENTS.forEach((event) => plugin.on(event, this._relayEvents[event]))
    this.pluginList.push(plugin)
    this.plugins[prefix] = plugin
  }

  /**
   * @param {IlpAddress} prefix
   * @returns {LedgerPlugin}
   */
  removePlugin (prefix) {
    const plugin = this.getPlugin(prefix)
    if (!plugin) return
    PLUGIN_EVENTS.forEach((event) => plugin.off(event, this._relayEvents[event]))
    this.pluginList.splice(this.pluginList.indexOf(plugin), 1)
    delete this.plugins[prefix]
    return plugin
  }
}

module.exports = Ledgers
