import Account , { AccountInfo } from '../types/account'
import { PluginInstance } from '../types/plugin'
import { AccountBase } from './base'
import { serializeIlpPrepare, deserializeIlpPrepare, deserializeIlpPacket, IlpReply, serializeIlpReply } from 'ilp-packet'
import { create as createLogger } from '../common/log'
const log = createLogger('plugin-account-service')

export default class PluginAccount extends AccountBase implements Account {

  protected _plugin: PluginInstance

  constructor (accountId: string, accountInfo: AccountInfo, plugin: PluginInstance) {
    super(accountId, accountInfo)
    this._plugin = plugin
    this._plugin.on('connect', this.emit.bind(this, 'connect'))
    this._plugin.on('disconnect', this.emit.bind(this, 'disconnect'))

    this._outgoingIlpPacketHandler = async (packet) => {
      return deserializeIlpPacket(await this._plugin.sendData(serializeIlpPrepare(packet))).data as IlpReply
    }
    this._outgoingMoneyHandler = async (amount) => {
      return this._plugin.sendMoney(amount)
    }

  }

  protected async _startup () {

    if (!this._incomingIlpPacketHandler) {
      throw new Error('No handler defined for outgoing packets. registerIlpPacketHander() must be called before startup.')
    } else {
      this._plugin.registerDataHandler(async (data: Buffer) => {
        return serializeIlpReply(await this._incomingIlpPacketHandler!(deserializeIlpPrepare(data)))
      })
    }

    if (!this._incomingMoneyHandler) {
      throw new Error('No handler defined for outgoing money. registerMoneyHandler() must be called before startup.')
    } else {
      this._plugin.registerMoneyHandler(async (amount: string) => {
        return this._incomingMoneyHandler!(amount)
      })
    }
    return this._plugin.connect({})
  }

  protected async _shutdown () {
    return this._plugin.disconnect()
  }

  isConnected () {
    return this._plugin.isConnected()
  }

  public getPlugin () {
    return this._plugin
  }
}
