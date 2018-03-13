import * as IlpPacket from 'ilp-packet'
import RouteBuilder from '../services/route-builder'
import { create as createLogger } from '../common/log'
const log = createLogger('ilqp')
import reduct = require('reduct')
const { InvalidPacketError } = IlpPacket.Errors

export default class IlqpController {
  protected routeBuilder: RouteBuilder

  constructor (deps: reduct.Injector) {
    this.routeBuilder = deps(RouteBuilder)
  }

  async sendData (packet: Buffer, sourceAccount: string) {
    log.debug('responding to ILQP quote request. clientName=' + sourceAccount)

    switch (packet[0]) {
      case IlpPacket.Type.TYPE_ILQP_LIQUIDITY_REQUEST:
        return IlpPacket.serializeIlqpLiquidityResponse(
          await this.routeBuilder.quoteLiquidity(
            sourceAccount,
            IlpPacket.deserializeIlqpLiquidityRequest(packet)
          )
        )
      case IlpPacket.Type.TYPE_ILQP_BY_SOURCE_REQUEST:
        return IlpPacket.serializeIlqpBySourceResponse(
          await this.routeBuilder.quoteBySource(
            sourceAccount,
            IlpPacket.deserializeIlqpBySourceRequest(packet)
          )
        )
      case IlpPacket.Type.TYPE_ILQP_BY_DESTINATION_REQUEST:
        return IlpPacket.serializeIlqpByDestinationResponse(
          await this.routeBuilder.quoteByDestination(
            sourceAccount,
            IlpPacket.deserializeIlqpByDestinationRequest(packet)
          )
        )
      default:
        throw new InvalidPacketError('packet has unexpected type.')
    }
  }
}
