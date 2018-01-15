'use strict'

import * as IlpPacket from 'ilp-packet'
import IldcpHostController from './ildcp-host'
import InvalidPacketError from '../errors/invalid-packet-error'
import reduct = require('reduct')

const PEER_PROTOCOL_CONDITION = Buffer.from('Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=', 'base64')

export default class PeerProtocolController {
  protected ildcpHostController: IldcpHostController

  constructor (deps: reduct.Injector) {
    this.ildcpHostController = deps(IldcpHostController)
  }

  async handle (
    data: Buffer,
    sourceAccount: string,
    { parsedPacket }: { parsedPacket: IlpPacket.IlpPrepare }
  ) {
    if (!PEER_PROTOCOL_CONDITION.equals(parsedPacket.executionCondition)) {
      throw new InvalidPacketError('condition must be peer protocol condition.')
    }

    switch (parsedPacket.destination) {
      case 'peer.config':
        const result = await this.ildcpHostController.handle(data, sourceAccount)

        return result
      default:
        throw new InvalidPacketError('unknown peer protocol.')
    }
  }
}
