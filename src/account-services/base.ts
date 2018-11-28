import { AccountInfo } from '../types/accounts'
import createLogger from 'ilp-logger'
import MiddlewareManager from '../services/middleware-manager'
import { AccountService } from '../types/account-service'
import { MoneyHandler } from '../types/plugin'
import { IlpPrepare, IlpPacketHander, IlpReply, Errors } from 'ilp-packet'
import { EventEmitter } from 'events'
const { UnreachableError } = Errors
const log = createLogger('plugin-account-service')

export class AccountServiceBase extends EventEmitter implements AccountService {

  protected _id: string
  protected _info: AccountInfo
  protected _outgoingIlpPacketHandler?: IlpPacketHander
  protected _outgoingMoneyHandler?: MoneyHandler
  protected _incomingIlpPacketHandler?: IlpPacketHander
  protected _incomingMoneyHandler?: MoneyHandler
  protected _middlewareManager?: MiddlewareManager
  private _started: boolean = false

  constructor (accountId: string, accountInfo: AccountInfo, middlewares: string[]) {
    super()
    this._id = accountId
    this._info = accountInfo
  }

  public get id () {
    return this._id
  }

  public get info () {
    return this._info
  }

  public async startup (): Promise<void> {
    this._started = true
    await this._startup()
  }

  protected async _startup () {
    // Subclasses must override this method with any logic that must be performed before the startup pipeline executes
  }

  public async shutdown (): Promise<void> {
    return this._shutdown()
  }

  protected async _shutdown () {
    // Subclasses must override this method with any logic that must be performed after the shutdown pipeline executes
  }

  public isConnected (): boolean {
    throw new Error('isConnected must be implemented.')
  }

  async sendIlpPacket (packet: IlpPrepare): Promise<IlpReply> {
    if (this._outgoingIlpPacketHandler) {
      return this._outgoingIlpPacketHandler(packet)
    }
    throw new Error('No handler defined for outgoing packets. _outgoingIlpPacketHandler must be set before startup.')
  }

  public registerIlpPacketHandler (handler: IlpPacketHander) {
    if (this._started) {
      log.error('Can\'t register handler after sertvice has started.')
      throw new Error('Can\'t register handler after sertvice has started.')
    }
    this._incomingIlpPacketHandler = handler
  }

  public deregisterIlpPacketHandler () {
    this._incomingIlpPacketHandler = async () => {
      throw new UnreachableError('Unable to forward packet. No upstream bound to account.')
    }
  }

  async sendMoney (amount: string): Promise<void> {
    if (this._outgoingMoneyHandler) {
      return this._outgoingMoneyHandler(amount)
    }
    throw new Error('No handler defined for outgoing money. _outgoingMoneyHandler must be set before startup.')
  }

  public registerMoneyHandler (handler: MoneyHandler) {
    if (this._started) {
      log.error('Can\'t register handler after sertvice has started.')
      throw new Error('Can\'t register handler after sertvice has started.')
    }
    this._incomingMoneyHandler = handler
  }

  public deregisterMoneyHandler () {
    this._incomingMoneyHandler = async () => { return }
  }

}
