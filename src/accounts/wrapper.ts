import Account from '../types/account'
import { AccountBase } from './base'
import { IlpReply, IlpPrepare } from 'ilp-packet'
import PluginAccount from './plugin'

/**
 * A simple account service designed to wrap middleware pipelines that connect to another account service
 */
export default class WrapperAccount extends AccountBase implements Account {

  private _wrappedAccount: Account
  private _startupPipeline: (dummy: void) => Promise<void>
  private _shutdownPipline: (dummy: void) => Promise<void>

  constructor (account: Account,
    outgoingIlpPacketPipeline: (packet: IlpPrepare) => Promise<IlpReply>,
    outgoingMoneyPipeline: (packet: string) => Promise<void>,
    startupPipeline: (dummy: void) => Promise<void>,
    shutdownPipeline: (dummy: void) => Promise<void>) {

    super(account.id, account.info)

    this._wrappedAccount = account

    this._startupPipeline = startupPipeline
    this._shutdownPipline = shutdownPipeline
    this._outgoingIlpPacketHandler = outgoingIlpPacketPipeline
    this._outgoingMoneyHandler = outgoingMoneyPipeline

    // TODO - Should we detach existing listeners and re-attach to this?
    this._wrappedAccount.on('connect', () => this.emit('connect'))
    this._wrappedAccount.on('disconnect', () => this.emit('disconnect'))
  }

  async sendMoney (amount: string): Promise<void> {
    if (this._outgoingMoneyHandler) {
      return this._outgoingMoneyHandler(amount)
    }
    throw new Error('No handler defined for outgoing packets. _outgoingMoneyHandler must be set before startup.')
  }

  protected async _startup () {
    return this._startupPipeline(undefined)
  }

  protected async _shutdown () {
    return this._shutdownPipline(undefined)
  }

  isConnected () {
    return this._wrappedAccount.isConnected()
  }

  getPlugin () {
    if (this._wrappedAccount instanceof PluginAccount) {
      return this._wrappedAccount.getPlugin()
    }
    throw new Error('no plugin for account.')
  }

  handleIncomingIlpPacket (packet: IlpPrepare) {
    if (this._incomingIlpPacketHandler) {
      return this._incomingIlpPacketHandler(packet)
    }
    throw new Error('no plugin for account.')
  }

  handleIncomingMoney (amount: string) {
    if (this._incomingMoneyHandler) {
      return this._incomingMoneyHandler(amount)
    }
    throw new Error('no plugin for account.')
  }

}
