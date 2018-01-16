import reduct = require('reduct')
import { cloneDeep } from 'lodash'
import compat from 'ilp-compat-plugin'
import Store from '../services/store'
import Config from './config'
import { EventEmitter } from 'events'
import { AccountInfo } from '../types/accounts'
import {
  ConnectOptions,
  PluginInstance
} from '../types/plugin'
import ILDCP = require('ilp-protocol-ildcp')

import { create as createLogger } from '../common/log'
const log = createLogger('accounts')

export interface AccountEntry {
  plugin: PluginInstance,
  info: AccountInfo
}

export default class Accounts extends EventEmitter {
  protected config: Config
  protected store: Store

  protected address: string
  protected accounts: Map<string, AccountEntry>

  protected parentAccount?: string

  constructor (deps: reduct.Injector) {
    super()

    this.config = deps(Config)
    this.store = deps(Store)

    this.address = this.config.ilpAddress || 'unknown'
    this.accounts = new Map()
    this.parentAccount = undefined
  }

  async connectToParent () {
    if (this.parentAccount) {
      const parent = this.getPlugin(this.parentAccount)

      await parent.connect({})

      const ildcpInfo = await ILDCP.fetch(parent.sendData.bind(parent))

      this.setOwnAddress(ildcpInfo.clientAddress)
    } else {
      throw new Error('no parent account specified.')
    }
  }

  async connect (options: ConnectOptions) {
    const unconnectedAccounts = Array.from(this.accounts.values())
      .filter(account => !account.plugin.isConnected())
    return Promise.all(unconnectedAccounts.map(account => account.plugin.connect(options)))
  }

  async disconnect () {
    const connectedAccounts = Array.from(this.accounts.values())
      .filter(account => account.plugin.isConnected())
    return Promise.all(connectedAccounts.map(account => account.plugin.disconnect()))
  }

  getOwnAddress () {
    return this.address
  }

  setOwnAddress (newAddress) {
    log.info('setting ilp address. oldAddress=%s newAddress=%s', this.address, newAddress)
    this.address = newAddress
  }

  getPlugin (accountId: string) {
    const account = this.accounts.get(accountId)

    if (!account) {
      log.warn('could not find plugin for account id. accountId=%s', accountId)
      throw new Error('unknown account id. accountId=' + accountId)
    }

    return account.plugin
  }

  exists (accountId: string) {
    return this.accounts.has(accountId)
  }

  getAccountIds () {
    return Array.from(this.accounts.keys())
  }

  getParentId () {
    return this.parentAccount
  }

  getAssetCode (accountId: string) {
    const account = this.accounts.get(accountId)

    if (!account) {
      log.debug('no currency found. account=%s', accountId)
      return undefined
    }

    return account.info.assetCode
  }

  add (accountId: string, creds: any) {
    log.info('add account. accountId=%s', accountId)

    creds = cloneDeep(creds)

    try {
      this.config.validateAccount(accountId, creds)
    } catch (err) {
      if (err.name === 'InvalidJsonBodyError') {
        log.warn('validation error in account config. id=%s', accountId)
        err.debugPrint(log.warn)
        throw new Error('error while adding account, see error log for details.')
      }

      throw err
    }

    if (creds.relation === 'parent') {
      if (this.parentAccount) {
        throw new Error('only one account may be marked as relation=parent. id=' + accountId)
      }

      this.parentAccount = accountId
    }

    const Plugin = require(creds.plugin)

    const api: any = {}
    // Lazily create plugin utilities
    Object.defineProperty(api, 'store', {
      get: () => {
        return this.store.getPluginStore(accountId)
      }
    })
    Object.defineProperty(api, 'log', {
      get: () => {
        return createLogger(`${creds.plugin}[${accountId}]`)
      }
    })

    const opts = Object.assign({}, creds.options)
    // Provide old deprecated _store and _log properties
    Object.defineProperty(opts, '_store', {
      get: () => {
        log.warn('DEPRECATED: plugin accessed deprecated _store property. accountId=%s', accountId)
        return api.store
      }
    })
    Object.defineProperty(opts, '_log', {
      get: () => {
        log.warn('DEPRECATED: plugin accessed deprecated _log property. accountId=%s', accountId)
        return api.log
      }
    })

    const plugin = compat(new Plugin(opts, api))

    this.accounts.set(accountId, {
      info: creds,
      plugin
    })

    this.emit('add', accountId, plugin)
  }

  remove (accountId: string) {
    const plugin = this.getPlugin(accountId)
    if (!plugin) {
      return undefined
    }
    log.info('remove account. accountId=' + accountId)

    this.emit('remove', accountId, plugin)

    if (this.parentAccount === accountId) {
      this.parentAccount = undefined
    }

    this.accounts.delete(accountId)
    return plugin
  }

  getInfo (accountId: string) {
    const account = this.accounts.get(accountId)

    if (!account) {
      throw new Error('unknown account id. accountId=' + accountId)
    }

    return account.info
  }

  getChildAddress (accountId: string) {
    const info = this.getInfo(accountId)

    if (info.relation !== 'child') {
      throw new Error('Can\'t generate child address for account that is isn\'t a child')
    }

    const ilpAddressSegment = info.ilpAddressSegment || accountId

    return this.config.ilpAddress + '.' + ilpAddressSegment
  }
}
