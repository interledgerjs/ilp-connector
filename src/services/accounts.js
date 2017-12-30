'use strict'

const _ = require('lodash')
const EventEmitter = require('eventemitter2')
const compat = require('ilp-compat-plugin')
const Store = require('../services/store.js')
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
    this.store = deps(Store)

    this._pluginList = [] // LedgerPlugin[]
    this.plugins = {} // { prefix ⇒ LedgerPlugin }
    this._prefixReverseMap = new Map() // { LedgerPlugin ⇒ prefix }
    this._config = config
    this._accounts = new Map()
    this._accountInfo = new Map()
    this.createIlpRejection = createIlpRejection.bind(null, config.ilpAddress)
    this._dataHandler = null
    this._moneyHandler = null
    this._parentAccount = null

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

  getPlugin (accountId) {
    if (accountId.slice(-1) === '.') {
      throw new Error('peer address must not end with "."')
    }
    return this.plugins[accountId] || null
  }

  getPlugins () {
    return this._pluginList
  }

  getPrefixes () {
    return Object.keys(this.plugins)
  }

  getCurrency (accountId) {
    const account = this._accounts.get(accountId)

    if (!account) {
      log.debug('no currency found. account=' + accountId)
      return null
    }

    return account.currency
  }

  add (accountId, creds, tradesTo, tradesFrom) {
    log.info('add account. peerId=' + accountId)

    creds = _.cloneDeep(creds)

    try {
      this._config.validateAccount(accountId, creds)
    } catch (err) {
      if (err.name === 'InvalidJsonBodyError') {
        log.warn('validation error in account config. id=%s', accountId)
        err.debugPrint(log.warn)
        throw new Error('error while adding account, see error log for details.')
      }

      throw err
    }

    if (creds.relation === 'parent') {
      if (this._parentAccount) {
        throw new Error('only one account may be marked as relation=parent. id=' + accountId)
      }

      this._parentAccount = accountId
    }

    const store = this.store.getPluginStore(accountId)

    creds.options.prefix = accountId
    const Plugin = require(creds.plugin)
    const plugin = compat(new Plugin(Object.assign({}, creds.options, {
      prefix: accountId + '.',
      // non JSON-stringifiable fields are prefixed with an underscore
      _store: store,
      _log: logger.create(creds.plugin)
    })))

    if (creds.overrideInfo) {
      log.debug('using overridden info for plugin. account=%s info=%j', accountId, creds.overrideInfo)
    }
    const accountInfo = Object.assign({
      relation: creds.relation,
      currency: creds.currency,
      currencyScale: creds.currencyScale
    }, creds.overrideInfo)
    this._accountInfo.set(accountId, accountInfo)

    if (accountId.slice(-1) === '.') {
      throw new Error('peer address must not end with "."')
    }
    this._prefixReverseMap.set(plugin, accountId)
    this._pluginList.push(plugin)
    this.plugins[accountId] = plugin

    this._accounts.set(accountId, {
      currency: creds.currency,
      plugin
    })
    plugin.registerDataHandler(this._handleData.bind(this, accountId))
    plugin.registerMoneyHandler(this._handleMoney.bind(this, accountId))
  }

  remove (accountId) {
    const plugin = this.getPlugin(accountId)
    if (!plugin) {
      return
    }
    log.info('remove account. peerId=' + accountId)
    plugin.deregisterDataHandler()
    plugin.deregisterMoneyHandler()
    this._pluginList.splice(this._pluginList.indexOf(plugin), 1)

    if (this._parentAccount === accountId) {
      this._parentAccount = null
    }

    delete this.plugins[accountId]
    this._accountInfo.delete(accountId)
    this._prefixReverseMap.delete(plugin)
    this._accounts.delete(accountId)
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
