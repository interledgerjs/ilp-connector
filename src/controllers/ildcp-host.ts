import Accounts from '../services/accounts'
import { create as createLogger } from '../common/log'
import ILDCP = require('ilp-protocol-ildcp')
const log = createLogger('ildcp-host')
import reduct = require('reduct')
import { IlpPrepare, serializeIlpPrepare, IlpReply, deserializeIlpReply } from 'ilp-packet'

export default class IldcpHostController {
  protected accounts: Accounts

  constructor (deps: reduct.Injector) {
    this.accounts = deps(Accounts)
  }

  async handle (packet: IlpPrepare, sourceAccount: string): Promise<IlpReply> {
    const clientAddress = this.accounts.getChildAddress(sourceAccount)
    const info = this.accounts.get(sourceAccount).info
    log.trace('responding to ILDCP config request. clientAddress=%s', clientAddress)

    return deserializeIlpReply(await ILDCP.serve({
      requestPacket: serializeIlpPrepare(packet),
      handler: async () => ({
        clientAddress,
        assetScale: info.assetScale,
        assetCode: info.assetCode
      }),
      serverAddress: this.accounts.getOwnAddress()
    }))
  }
}
