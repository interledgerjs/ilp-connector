import { AccountInfo } from '../types/accounts'
import { PluginInstance } from '../types/plugin'
import { create as createLogger } from '../common/log'
import { AccountService } from '../types/account-service'
import { AccountServiceBase } from './base'
import { IlpPrepare, serializeIlpPrepare, deserializeIlpPrepare, serializeIlpFulfill, serializeIlpReject } from 'ilp-packet'
import { deserializeIlpReply, IlpReply, isFulfill } from '../types/packet'

const log = createLogger('plugin-account-service')

export default class PluginAccountService extends AccountServiceBase implements AccountService {

  protected plugin: PluginInstance

  constructor (accountId: string, accountInfo: AccountInfo, plugin: PluginInstance) {

    super(accountId, accountInfo)
    this.plugin = plugin
    this.plugin.on('connect', this._pluginConnect.bind(this))
    this.plugin.on('disconnect', this._pluginDisconnect.bind(this))

    // TODO - Setup internal middleware for balance tracking
  }

  async connect () {
    return this.plugin.connect({})
  }

  async disconnect () {
    return this.plugin.disconnect()
  }

  isConnected () {
    return this.plugin.isConnected()
  }

  async sendIlpPacket (packet: IlpPrepare) {
    return deserializeIlpReply(await this.plugin.sendData(serializeIlpPrepare(packet)))
  }

  registerIlpPacketHandler (handler: (data: IlpPrepare) => Promise<IlpReply>) {
    this.plugin.registerDataHandler(async (data: Buffer) => {
      const reply = await handler(deserializeIlpPrepare(data))
      return isFulfill(reply) ? serializeIlpFulfill(reply) : serializeIlpReject(reply)
    })
  }

  deregisterIlpPacketHandler () {
    this.plugin.deregisterDataHandler()
  }

  private _pluginConnect () {
    if (this.connectHandler) this.connectHandler()
  }

  private _pluginDisconnect () {
    if (this.disconnectHandler) this.disconnectHandler()
  }

  getInfo () {
    return this.info
  }
}
