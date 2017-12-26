'use strict'

const _ = require('lodash')
const EventEmitter = require('eventemitter2')
const compat = require('ilp-compat-plugin')
const PluginStore = require('../lib/plugin-store.js')
const Config = require('./config')
const logger = require('../common/log')
const log = logger.create('accounts')
const { createIlpRejection, codes } = require('../lib/ilp-errors')

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
  constructor (deps) {
    super()

    const config = deps(Config)

    this._pluginList = [] // LedgerPlugin[]
    this.plugins = {} // { prefix ⇒ LedgerPlugin }
    this._prefixReverseMap = new Map() // { LedgerPlugin ⇒ prefix }
    this._config = config
    this._accounts = new Map()
    this._accountInfo = new Map()
    this.createIlpRejection = createIlpRejection.bind(null, config.address)
    this._dataHandler = null
    this._moneyHandler = null

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
    return Promise.all(this._pluginList.map((plugin) => plugin.connect(options)))
  }

  getPlugin (accountAddress) {
    if (accountAddress.slice(-1) === '.') {
      throw new Error('peer address must not end with "."')
    }
    return this.plugins[accountAddress] || null
  }

  getPlugins () {
    return this._pluginList
  }

  getPrefixes () {
    return Object.keys(this.plugins)
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

    if (!this._config.validateAccount(accountAddress, creds)) {
      throw new Error('error while adding account, see error log for details.')
    }

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
      prefix: accountAddress + '.',
      debugReplyNotifications: this._config.features.debugReplyNotifications,
      // non JSON-stringifiable fields are prefixed with an underscore
      _store: store,
      _log: logger.create(creds.plugin)
    })))

    if (creds.overrideInfo) {
      log.debug('using overridden info for plugin. account=%s info=%j', accountAddress, creds.overrideInfo)
    }
    const accountInfo = Object.assign({
      currency: creds.currency,
      currencyScale: creds.currencyScale
    }, creds.overrideInfo)
    this._accountInfo.set(accountAddress, accountInfo)

    if (accountAddress.slice(-1) === '.') {
      throw new Error('peer address must not end with "."')
    }
    this._prefixReverseMap.set(plugin, accountAddress)
    this._pluginList.push(plugin)
    this.plugins[accountAddress] = plugin

    this._accounts.set(accountAddress, {
      currency: creds.currency,
      plugin
    })
    plugin.registerDataHandler(this._handleData.bind(this, accountAddress))
    plugin.registerMoneyHandler(this._handleMoney.bind(this, accountAddress))
  }

  remove (accountAddress) {
    const plugin = this.getPlugin(accountAddress)
    if (!plugin) {
      return
    }
    log.info('remove account. peerAddress=' + accountAddress)
    plugin.deregisterDataHandler()
    plugin.deregisterMoneyHandler()
    this._pluginList.splice(this._pluginList.indexOf(plugin), 1)
    delete this.plugins[accountAddress]
    this._accountInfo.delete(accountAddress)
    this._prefixReverseMap.delete(plugin)
    this._accounts.delete(accountAddress)
    return plugin
  }

  async _handleData (address, data) {
    if (!this._dataHandler) {
      log.debug('no data handler, rejecting. from=%s', address)
      throw this.createIlpRejection({
        code: codes.F02_UNREACHABLE,
        message: 'Connector not ready'
      })
    }

    return this._dataHandler(address, data)
  }

  async _handleMoney (address, amount) {
    if (!this._moneyHandler) {
      log.debug('no money handler, ignoring. from=%s', address)
      return
    }

    return this._moneyHandler(address, amount)
  }

  registerDataHandler (dataHandler) {
    if (this._dataHandler) {
      throw new Error('data handler already registered.')
    }
    this._dataHandler = dataHandler
  }

  deregisterDataHandler () {
    this._dataHandler = null
  }

  registerMoneyHandler (moneyHandler) {
    if (this._moneyHandler) {
      throw new Error('money handler already registered.')
    }
    this._moneyHandler = moneyHandler
  }

  deregisterMoneyHandler () {
    this._moneyHandler = null
  }

  getPrefix (plugin) {
    return this._prefixReverseMap.get(plugin)
  }

  getInfo (prefix) {
    return this._accountInfo.get(prefix)
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
