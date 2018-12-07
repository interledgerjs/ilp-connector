import Account , { AccountInfo } from '../types/account'
import { AccountBase } from './base'
import { IlpReply} from 'ilp-packet'
import { create as createLogger } from '../common/log'
const log = createLogger('loop-back-account-service')

export default class LoopBackAccount extends AccountBase implements Account {

  protected connected: boolean = false

  constructor (accountId: string, accountInfo: AccountInfo) {
    super(accountId, accountInfo)

    this._outgoingIlpPacketHandler = async (packet) => {

      const reply = {
        fulfillment: packet.data.slice(0, 32),
        data: packet.data
      } as IlpReply

      return Promise.resolve(reply)
    }

    this._outgoingMoneyHandler = async (amount) => {
      return
    }

  }

  protected async _startup () {
    this.connected = true
  }

  protected async _shutdown () {
    this.connected = false
  }

  isConnected () {
    return this.connected
  }
}
