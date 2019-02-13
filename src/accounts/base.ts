import Account, { AccountInfo, AccountMiddlewarePipelines } from '../types/account'
import { MoneyHandler } from '../types/plugin'
import { IlpPrepare, IlpPacketHander, IlpReply, Errors } from 'ilp-packet'
import { EventEmitter } from 'events'
const { UnreachableError } = Errors
import { create as createLogger } from '../common/log'
import { IlpEndpoint, RequestHandler } from '../types/ilp-endpoint';
const log = createLogger('plugin-account-service')

export class AccountBase extends EventEmitter implements Account {

  protected _id: string
  protected _info: AccountInfo
  protected _outgoingIlpPacketHandler?: IlpPacketHander
  protected _outgoingMoneyHandler?: MoneyHandler
  protected _incomingIlpPacketHandler?: IlpPacketHander
  protected _incomingMoneyHandler?: MoneyHandler
  protected _startupHandler?: (param: void) => Promise<void>
  protected _shutdownHandler?: (param: void) => Promise<void>
  protected _endpoint: IlpEndpoint
  
  private _started: boolean = false

  constructor (accountId: string, accountInfo: AccountInfo, endpoint: IlpEndpoint) {
    super()
    this._id = accountId
    this._info = accountInfo
    this._endpoint = endpoint
  }

  public get id () {
    return this._id
  }

  public get info () {
    return this._info
  }

  public async startup (): Promise<void> {
    if (!this._incomingIlpPacketHandler) throw new Error('an incoming Ilp packet handler needs to be registered to start up')
    // point ilp-endpoint handler to incoming middleware pipeline
    this._endpoint.handlerProvider = (packet: IlpPrepare) => this._incomingIlpPacketHandler!
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

  public registerMiddlewarePipelines ({incomingIlpPacketPipeline, outgoingIlpPacketPipeline, startupPipeline, shutdownPipeline}: AccountMiddlewarePipelines): void {
    if(this._started) throw new Error('Middleware pipelines must be set before startup')
    this._incomingIlpPacketHandler = incomingIlpPacketPipeline
    this._outgoingIlpPacketHandler = outgoingIlpPacketPipeline
    this._startupHandler = startupPipeline
    this._shutdownHandler = shutdownPipeline
  }

  public registerIlpEndpoint (endpoint: IlpEndpoint): void {
    if(this._started) throw new Error('ilp-endpoint must be set before startup')
    this._endpoint = endpoint
  }

  async sendIlpPacket (packet: IlpPrepare): Promise<IlpReply> {
    if (this._outgoingIlpPacketHandler) {
      return this._outgoingIlpPacketHandler(packet)
    }
    throw new Error('No handler defined for outgoing packets. _outgoingIlpPacketHandler must be set before startup.')
  }
}
