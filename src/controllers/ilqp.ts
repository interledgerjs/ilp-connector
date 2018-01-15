'use strict'

import * as IlpPacket from 'ilp-packet'
import RouteBuilder from '../services/route-builder'
import { create as createLogger } from '../common/log'
const log = createLogger('ilqp')
import InvalidPacketError from '../errors/invalid-packet-error'
import reduct = require('reduct')

export default class IlqpController {
  protected routeBuilder: RouteBuilder

  constructor (deps: reduct.Injector) {
    this.routeBuilder = deps(RouteBuilder)
  }

  async sendData (packet: Buffer, sourceAccount: string) {
    log.debug('responding to ILQP quote request. clientName=' + sourceAccount)

    const packetData = Object.assign(
      { sourceAccount },
      IlpPacket.deserializeIlpPacket(packet).data)
    switch (packet[0]) {
      case IlpPacket.Type.TYPE_ILQP_LIQUIDITY_REQUEST:
        return IlpPacket.serializeIlqpLiquidityResponse(
          await this.routeBuilder.quoteLiquidity(packetData as IlpPacket.IlqpLiquidityRequest & { sourceAccount: string })
        )
      case IlpPacket.Type.TYPE_ILQP_BY_SOURCE_REQUEST:
        return IlpPacket.serializeIlqpBySourceResponse(
          await this.routeBuilder.quoteBySource(packetData as IlpPacket.IlqpBySourceRequest & { sourceAccount: string })
        )
      case IlpPacket.Type.TYPE_ILQP_BY_DESTINATION_REQUEST:
        return IlpPacket.serializeIlqpByDestinationResponse(
          await this.routeBuilder.quoteByDestination(packetData as IlpPacket.IlqpByDestinationRequest & { sourceAccount: string })
        )
      default:
        throw new InvalidPacketError('packet has unexpected type.')
    }
  }
}
