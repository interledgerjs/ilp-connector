import reduct = require('reduct')
import Store from './store'
import Config from './config'
import Stats from './stats'
import { EventEmitter } from 'events'
import {
  IlpPrepare,
  IlpReply,
  Errors
} from 'ilp-packet'
import { create as createLogger } from '../common/log'
import Middleware from '../types/middleware'
import Account from '../types/account'
import AccountProvider, { constructAccountProvider } from '../types/account-provider'
import PluginAccountProvider from '../account-providers/plugin'
import { constructMiddlewares, wrapMiddleware } from '../lib/middleware'
import WrapperAccount from '../accounts/wrapper'
const { UnreachableError } = Errors
const log = createLogger('accounts')

export default class Accounts extends EventEmitter {
  protected _config: Config
  protected _store: Store
  protected _stats: Stats
  protected _middlewares: { [key: string]: Middleware } = {}
  protected _address: string
  protected _accounts: Map<string, Account>
  protected _accountProviders: Set<AccountProvider>

  protected _coreIlpPacketHander: (packet: IlpPrepare, accountId: string, outbound: (packet: IlpPrepare, accountId: string) => Promise<IlpReply>) => Promise<IlpReply>
  protected _coreMoneyHandler: (amount: string, accountId: string) => Promise<void>

  constructor (deps: reduct.Injector) {
    super()

    this._config = deps(Config)
    this._store = deps(Store)
    this._stats = deps(Stats)
    this._address = this._config.ilpAddress || 'unknown'
    this._accounts = new Map()
    this._accountProviders = new Set()

    this._coreIlpPacketHander = (packet: IlpPrepare, accountId: string, outbound: (packet: IlpPrepare, accountId: string) => Promise<IlpReply>) => {
      throw new UnreachableError('no core packet handler configured.')
    }

    this._coreMoneyHandler = (amount: string, accountId: string) => {
      throw new UnreachableError('no core money handler configured.')
    }
  }

  private getAccountMiddleware (account: Account) {
    return account.info.disableMiddleware ? {} : this._middlewares
  }

  public setup (deps: reduct.Injector) {
    // Setup middleware
    this._middlewares = constructMiddlewares(deps)

    // Load up account providers
    for (const config of Object.values(this._config.accountProviders)) {
      this._accountProviders.add(constructAccountProvider(config, deps))
    }
  }

  public async sendIlpPacket (packet: IlpPrepare, accountId: string): Promise<IlpReply> {
    try {
      const account = this._accounts.get(accountId)
      if (account) {
        return await account.sendIlpPacket(packet)
      } else {
        throw new UnreachableError('unknown account: ' + accountId)
      }
    } catch (e) {
      let err = e
      if (!err || typeof err !== 'object') {
        err = new Error('non-object thrown. value=' + e)
      }
      if (!err.ilpErrorCode) {
        err.ilpErrorCode = Errors.codes.F02_UNREACHABLE
      }
      err.message = 'failed to send packet: ' + err.message
      throw err
    }
  }

  public sendMoney (amount: string, accountId: string): Promise<void> {
    const account = this.get(accountId)
    if (!account) {
      throw new Error('unable to send money. unknown account: ' + accountId)
    }
    return account.sendMoney(amount)
  }

  public registerCoreIlpPacketHandler (handler: (packet: IlpPrepare, accountId: string, outbound: (packet: IlpPrepare, accountId: string) => Promise<IlpReply>) => Promise<IlpReply>) {
    this._coreIlpPacketHander = handler
  }

  public registerCoreMoneyHandler (handler: (amount: string, accountId: string) => Promise<void>) {
    this._coreMoneyHandler = handler
  }

  /**
   * Handle a new account emitted by an account provider.
   * This function will setup any configured middleware and then attach the middleware
   *
   * If there is no address configured then check if this is the parent account we'll get an address from
   * and if so, return it.
   *
   * @param account
   * @param provider
   */
  private async _handleNewAccount (account: Account, provider: AccountProvider): Promise<void> {

    log.debug(`Loading new account: ${account.id} (provider: ${provider})`)
    const middleware = this.getAccountMiddleware(account)
    const wrapper = await wrapMiddleware(account, middleware)
    this._accounts.set(account.id, wrapper)

    wrapper.registerIlpPacketHandler((packet: IlpPrepare) => {
      return this._coreIlpPacketHander(packet, account.id, this.sendIlpPacket.bind(this))
    })
    wrapper.registerMoneyHandler((amount: string) => {
      return this._coreMoneyHandler(amount, account.id)
    })

    this.emit('add', wrapper)

    // TODO - Is there a use case for providers to define a default handler for incoming packets and money?
    // We accept the provider as a parameter to allow for this in future
    // The default behaviour now is to pass ther packet or amount to the _coreIlpPacketHandler or _coreMoneyHandler
    // The default _coreIlpPacketHandler is the Core service
    // The default _coreMoneyHandler is a no-op
  }

  /**
   * During startup we start all of the account providers.
   */
  public async startup (): Promise<void> {
    if (!this._coreIlpPacketHander) throw new Error('no processIlpPacketHandler registered')
    for (const provider of this._accountProviders) {
      await provider.startup(async account => {
        try {
          await this._handleNewAccount(account, provider)
        } catch (e) {
          log.error(`error handling new account: ${account.id}`)
        }
      })
    }
  }

  public getOwnAddress () {
    return this._address
  }

  public setOwnAddress (address: string) {
    this._address = address
    this.emit('address', address)
  }

  public getChildAddress (accountId: string) {
    const info = this.get(accountId).info

    if (info.relation !== 'child') {
      throw new Error('Can\'t generate child address for account that is isn\'t a child')
    }

    const ilpAddressSegment = info.ilpAddressSegment || accountId

    return this._address + '.' + ilpAddressSegment
  }

  public has (accountId: string) {
    return this._accounts.has(accountId)
  }
  public keys () {
    return this._accounts.keys()
  }

  public values () {
    return this._accounts.values()
  }

  public get (accountId: string): Account {
    const account = this._accounts.get(accountId)
    if (!account) {
      log.error('could not find account service for account id. accountId=%s', accountId)
      throw new Error('unknown account id. accountId=' + accountId)
    }
    return account
  }

  public async addPlugin (accountId: string, creds: any) {
    log.info('add plugin for account. accountId=%s', accountId)
    for (const provider of this._accountProviders) {
      if (provider instanceof PluginAccountProvider) {
        await provider.create(accountId, creds)
        return
      }
    }
    throw new Error('Can\'t add new plugin. The PluginAccountServiceProvider is not configured')
  }

  public async removePlugin (accountId: string) {
    log.info('remove plugin for account. accountId=%s', accountId)
    const account = this.get(accountId)
    await account.shutdown()
    this._accounts.delete(accountId)
  }

  public getStatus () {
    const accounts = {}
    this._accounts.forEach((account, accountId) => {
      let plugin = undefined
      try{
        plugin = (account as WrapperAccount).getPlugin()
      }
      catch {
        //do nothing
      }
      accounts[accountId] = {
        // Set info.options to undefined so that credentials aren't exposed.
        info: Object.assign({}, account.info, { options: undefined }),
        connected: account.isConnected(),
        adminInfo: plugin ? !!plugin.getAdminInfo : false
      }
    })
    return {
      address: this._address,
      accounts
    }
  }

  public getMiddleware(name: string): Middleware | undefined {
    return this._middlewares[name]
  }
}
