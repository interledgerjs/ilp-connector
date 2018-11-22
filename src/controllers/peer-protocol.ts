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
    packet: IlpPacket.IlpPrepare,
    sourceAccount: string
  ) {
    if (!PEER_PROTOCOL_CONDITION.equals(packet.executionCondition)) {
      throw new InvalidPacketError('condition must be peer protocol condition.')
    }

    if (packet.destination === 'peer.config') {
      return this.ildcpHostController.handle(packet, sourceAccount)
    } else if (packet.destination.startsWith('peer.route')) {
      return this.ccpController.handle(packet, sourceAccount)
    } else {
      throw new InvalidPacketError('unknown peer protocol.')
    }
  }
}
