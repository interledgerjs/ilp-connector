'use strict'

const _ = require('lodash')
const PluginStore = require('../lib/pluginStore.js')
const ilpCore = require('ilp-core')
const TradingPairs = require('./trading-pairs')
const logger = require('../common/log')
const log = logger.create('ledgers')

class Ledgers {
  constructor ({ config, routingTables }) {
    this._config = config
    this._core = new ilpCore.Core({ routingTables })
    this._pairs = new TradingPairs()
    this._ledgers = new Map()
  }

  addFromCredentialsConfig (ledgerCredentials) {
    for (let ledgerPrefix of Object.keys(ledgerCredentials)) {
      this.add(ledgerPrefix, ledgerCredentials[ledgerPrefix])
    }
  }

  connect (options) {
    return this._core.connect(options)
  }

  getPlugin (ledgerPrefix) {
    return this._core.getPlugin(ledgerPrefix)
  }

  getClient (ledgerPrefix) {
    return this._core.getClient(ledgerPrefix)
  }

  quote (params) {
    return this._core.quote(params)
  }

  getPairs () {
    return this._pairs.toArray()
  }

  setPairs (pairs) {
    this._pairs.empty()
    this._pairs.addPairs(pairs)
  }

  getCore () {
    return this._core
  }

  getClients () {
    return this._core.getClients()
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
    const client = new ilpCore.Client(Object.assign({}, creds.options, {
      debugReplyNotifications: this._config.features.debugReplyNotifications,
      // non JSON-stringifiable fields are prefixed with an underscore
      _plugin: require(creds.plugin),
      _store: store,
      _log: logger.create(creds.plugin)
    }))
    this._core.addClient(ledgerPrefix, client)
    this._ledgers.set(ledgerPrefix, {
      currency: creds.currency,
      plugin: client.getPlugin()
    })

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
    this._core.removeClient(ledgerPrefix)
    this._ledgers.delete(ledgerPrefix)
    return plugin
  }
}

module.exports = Ledgers
