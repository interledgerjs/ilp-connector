import * as IlpPacket from 'ilp-packet'
import IldcpHostController from './ildcp-host'
import CcpController from './ccp'
import reduct = require('reduct')
const { InvalidPacketError } = IlpPacket.Errors

const PEER_PROTOCOL_CONDITION = Buffer.from('Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=', 'base64')

export default class PeerProtocolController {
  private ildcpHostController: IldcpHostController
  private ccpController: CcpController

  constructor (deps: reduct.Injector) {
    this.ildcpHostController = deps(IldcpHostController)
    this.ccpController = deps(CcpController)
  }

  async handle (
    data: Buffer,
    sourceAccount: string,
    { parsedPacket }: { parsedPacket: IlpPacket.IlpPrepare }
  ) {
    if (!PEER_PROTOCOL_CONDITION.equals(parsedPacket.executionCondition)) {
      throw new InvalidPacketError('condition must be peer protocol condition.')
    }

    if (parsedPacket.destination === 'peer.config') {
      return this.ildcpHostController.handle(data, sourceAccount)
    } else if (parsedPacket.destination.startsWith('peer.route')) {
      return this.ccpController.handle(data, sourceAccount, { parsedPacket })
    } else {
      throw new InvalidPacketError('unknown peer protocol.')
    }
  }
}
