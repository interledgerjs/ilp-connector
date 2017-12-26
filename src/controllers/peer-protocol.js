'use strict'

const IlpPacket = require('ilp-packet')
const IldcpHostController = require('./ildcp-host')
const InvalidPacketError = require('../errors/invalid-packet-error')

const PEER_PROTOCOL_CONDITION = Buffer.from('Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU=', 'base64')
const PEER_PROTOCOL_FULFILLMENT = Buffer.alloc(32)

class PeerProtocolController {
  constructor (deps) {
    this.ildcpHostController = deps(IldcpHostController)
  }

  async handle (sourceAccount, parsedPacket) {
    if (!PEER_PROTOCOL_CONDITION.equals(parsedPacket.executionCondition)) {
      throw new InvalidPacketError('condition must be null.')
    }

    switch (parsedPacket.destination) {
      case 'peer.config':
        const result = await this.ildcpHostController.handle(sourceAccount, parsedPacket.data)

        return IlpPacket.serializeIlpFulfill({
          fulfillment: PEER_PROTOCOL_FULFILLMENT,
          data: result
        })
      default:
        throw new InvalidPacketError('unknown peer protocol.')
    }
  }
}

module.exports = PeerProtocolController
