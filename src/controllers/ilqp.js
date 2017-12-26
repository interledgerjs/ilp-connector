'use strict'

const IlpPacket = require('ilp-packet')
const RouteBuilder = require('../services/route-builder')
const log = require('../common').log.create('ilqp')
const InvalidPacketError = require('../errors/invalid-packet-error')

class IlqpController {
  constructor (deps) {
    this.routeBuilder = deps(RouteBuilder)
  }

  async handle (sourceAccount, packet) {
    log.debug('responding to ILQP quote request. clientName=' + sourceAccount)

    const packetData = Object.assign(
      { sourceAccount },
      IlpPacket.deserializeIlpPacket(packet).data)
    switch (packet[0]) {
      case IlpPacket.Type.TYPE_ILQP_LIQUIDITY_REQUEST:
        return IlpPacket.serializeIlqpLiquidityResponse(
          await this.routeBuilder.quoteLiquidity(packetData)
        )
      case IlpPacket.Type.TYPE_ILQP_BY_SOURCE_REQUEST:
        return IlpPacket.serializeIlqpBySourceResponse(
          await this.routeBuilder.quoteBySource(packetData)
        )
      case IlpPacket.Type.TYPE_ILQP_BY_DESTINATION_REQUEST:
        return IlpPacket.serializeIlqpByDestinationResponse(
          await this.routeBuilder.quoteByDestination(packetData)
        )
      default:
        throw new InvalidPacketError('packet has unexpected type.')
    }
  }
}

module.exports = IlqpController
