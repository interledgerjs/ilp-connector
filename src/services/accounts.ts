import reduct = require('reduct')
import Store from '../services/store'
import Config from './config'
import { EventEmitter } from 'events'
import { AccountInfo } from '../types/accounts'
import { AccountService } from 'ilp-account-service'
import ILDCP = require('ilp-protocol-ildcp')
import { AccountManagerInstance, AccountManagerConstructor } from '../types/account-manager'
import { loadModuleOfType } from '../lib/utils'
import { deserializeIlpPrepare, serializeIlpFulfill, serializeIlpReject, isFulfill } from 'ilp-packet'
import PluginAccountManager from '../account_managers/plugin'
import { create as createLogger } from '../common/log'
const log = createLogger('accounts')

const DEFAULT_ACCOUNT_MANAGER = 'plugin'

export default class Accounts extends EventEmitter {
  protected config: Config
  protected store: Store

  protected address: string
  protected accountManager: AccountManagerInstance

  constructor (deps: reduct.Injector) {
    super()

    this.config = deps(Config)
    this.store = deps(Store)
    this.address = this.config.ilpAddress || 'unknown'
    const AccountManager: AccountManagerConstructor = loadModuleOfType('account_manager', this.config['account-manager'] || DEFAULT_ACCOUNT_MANAGER)
    this.accountManager = new AccountManager(deps)
  }

  async loadIlpAddress () {
    const inheritFrom = this.config.ilpAddressInheritFrom ||
      // Get account id of first parent
      [...this.accountManager.getAccounts()]
        .filter(([key, value]) => value.getInfo().relation === 'parent')
        .map(([key]) => key)[0]

    if (this.config.ilpAddress === 'unknown' && !inheritFrom) {
      throw new Error('When there is no parent, ILP address must be specified in configuration.')
    } else if (this.config.ilpAddress === 'unknown' && inheritFrom) {

      // TODO - Fix up after removing extra serializtion in ILDCP
      const ildcpInfo = await ILDCP.fetch(async (data: Buffer) => {
        const reply = await this.getAccountService(inheritFrom).sendIlpPacket(deserializeIlpPrepare(data))
        return isFulfill(reply) ? serializeIlpFulfill(reply) : serializeIlpReject(reply)
      })

      this.setOwnAddress(ildcpInfo.clientAddress)

      if (this.address === 'unknown') {
        log.error('could not get ilp address from parent.')
        throw new Error('no ilp address configured.')
      }
    }
  }

  async add (accountId: string, creds: any) {
    log.info('add account. accountId=%s', accountId)
    if (this.accountManager instanceof PluginAccountManager) {
      return this.accountManager.addAccount(accountId, creds)
    }
  }

  async remove (accountId: string) {
    log.info('remove account. accountId=%s', accountId)
    if (this.accountManager instanceof PluginAccountManager) {
      return this.accountManager.removeAccount(accountId)
    }
  }
  getOwnAddress () {
    return this.address
  }

  setOwnAddress (newAddress: string) {
    log.trace('setting ilp address. oldAddress=%s newAddress=%s', this.address, newAddress)
    this.address = newAddress
  }

  exists (accountId: string) {
    return this.accountManager.getAccounts().has(accountId)
  }

  getAccountIds () {
    return Array.from(this.accountManager.getAccounts().keys())
  }

  getAssetCode (accountId: string) {
    const accountService = this.getAccountService(accountId)

    if (!accountService) {
      log.error('no currency found. account=%s', accountId)
      return undefined
    }

    return accountService.getInfo().assetCode
  }

  getInfo (accountId: string): AccountInfo {
    const accountService = this.getAccountService(accountId)

    if (!accountService) {
      throw new Error('unknown account id. accountId=' + accountId)
    }

    return accountService.getInfo()
  }

  getChildAddress (accountId: string) {
    const info = this.getInfo(accountId)

    if (info.relation !== 'child') {
      throw new Error('Can\'t generate child address for account that is isn\'t a child')
    }

    const ilpAddressSegment = info.ilpAddressSegment || accountId

    return this.address + '.' + ilpAddressSegment
  }

  getStatus () {
    const accounts = {}
    this.accountManager.getAccounts().forEach((accountService, accountId) => {
      accounts[accountId] = {
        // Set info.options to undefined so that credentials aren't exposed.
        info: Object.assign({}, accountService.getInfo(), { options: undefined }),
        connected: accountService.isConnected()
      }
    })
    return {
      address: this.address,
      accounts
    }
  }

  getAccountService (accountId: string): AccountService {
    const accountService = this.accountManager.getAccounts().get(accountId)
    if (!accountService) {
      log.error('could not find account service for account id. accountId=%s', accountId)
      throw new Error('unknown account id. accountId=' + accountId)
    }
    return accountService
  }

  registerNewAccountHandler (handler: (id: string, accountService: AccountService) => Promise<void>) {
    this.accountManager.registerNewAccountHandler(handler)
  }

  deregisterNewAccountHandler () {
    this.accountManager.deregisterNewAccountHandler()
  }

  registerRemoveAccountHandler (handler: (id: string) => void) {
    this.accountManager.registerRemoveAccountHandler(handler)
  }

  deregisterRemoveAccountHandler () {
    this.accountManager.deregisterRemoveAccountHandler()
  }

  async startup () {
    const ilpAddress = await this.accountManager.loadIlpAddress()
    this.setOwnAddress(ilpAddress)

    if (this.getOwnAddress() === 'unknown') {
      log.error('could not get ilp address from parent.')
      throw new Error('no ilp address configured.')
    }

    await this.accountManager.startup()
  }
}
