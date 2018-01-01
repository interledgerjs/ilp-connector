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

    this._config = config
    this._accounts = new Map()
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
    const plugins = Array.from(this._accounts.values())
    return Promise.all(plugins.map(account => account.plugin.connect(options)))
  }

  getOwnAddress () {
    return this._config.ilpAddress
  }

  getPlugin (accountId) {
    const account = this._accounts.get(accountId)

    if (!account) {
      log.warn('could not find plugin for account id. accountId=%s', accountId)
      throw new Error('unknown account id. accountId=' + accountId)
    }

    return account.plugin
  }

  exists (accountId) {
    return this._accounts.has(accountId)
  }

  getAccountIds () {
    return Array.from(this._accounts.keys())
  }

  getParentId () {
    return this._parentAccount
  }

  getAssetCode (accountId) {
    const account = this._accounts.get(accountId)

    if (!account) {
      log.debug('no currency found. account=' + accountId)
      return null
    }

    return account.info.assetCode
  }

  add (accountId, creds, tradesTo, tradesFrom) {
    log.info('add account. accountId=' + accountId)

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

    const Plugin = require(creds.plugin)
    const plugin = compat(new Plugin(Object.assign({}, creds.options, {
      // non JSON-stringifiable fields are prefixed with an underscore
      _store: store,
      _log: logger.create(creds.plugin)
    })))

    this._accounts.set(accountId, {
      info: creds,
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
    log.info('remove account. accountId=' + accountId)
    plugin.deregisterDataHandler()
    plugin.deregisterMoneyHandler()

    if (this._parentAccount === accountId) {
      this._parentAccount = null
    }

    this._accounts.delete(accountId)
    return plugin
  }

  async _handleData (accountId, data) {
    if (!this._dataHandler) {
      log.debug('no data handler, rejecting. from=%s', accountId)
      throw this.createIlpRejection({
        code: codes.F02_UNREACHABLE,
        message: 'Connector not ready'
      })
    }

    return this._dataHandler(accountId, data)
  }

  async _handleMoney (accountId, amount) {
    if (!this._moneyHandler) {
      log.debug('no money handler, ignoring. from=%s', accountId)
      return
    }

    return this._moneyHandler(accountId, amount)
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

  getInfo (accountId) {
    const account = this._accounts.get(accountId)

    if (!account) {
      throw new Error('unknown account id. accountId=' + accountId)
    }

    return account.info
  }

  getChildAddress (accountId) {
    const info = this.getInfo(accountId)

    if (info.relation !== 'child') {
      throw new Error('Can\'t generate child address for account that is isn\'t a child')
    }

    const ilpAddressSegment = info.ilpAddressSegment || accountId

    return this._config.ilpAddress + '.' + ilpAddressSegment
  }
}

module.exports = Accounts
