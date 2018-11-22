import { IlpPacket, deserializeIlpPrepare, IlpPrepare, Type } from 'ilp-packet'
import { create as createLogger } from '../common/log'
const log = createLogger('ilp-prepare')
import reduct = require('reduct')

import Accounts from '../services/accounts'
import RouteBuilder from '../services/route-builder'
import RateBackend from '../services/rate-backend'
import PeerProtocolController from '../controllers/peer-protocol'
import EchoController from '../controllers/echo'
import { IlpReply, isFulfill } from '../types/packet'

const PEER_PROTOCOL_PREFIX = 'peer.'

export default class IlpPrepareController {
  private accounts: Accounts
  private routeBuilder: RouteBuilder
  private backend: RateBackend
  private peerProtocolController: PeerProtocolController
  private echoController: EchoController

  constructor (deps: reduct.Injector) {
    this.accounts = deps(Accounts)
    this.routeBuilder = deps(RouteBuilder)
    this.backend = deps(RateBackend)
    this.peerProtocolController = deps(PeerProtocolController)
    this.echoController = deps(EchoController)
  }

  async sendIlpPacket (
    packet: IlpPrepare,
    sourceAccount: string,
    outbound: (data: IlpPrepare, accountId: string) => Promise<IlpReply>
  ): Promise<IlpReply> {
    const { amount, executionCondition, destination, expiresAt, data } = packet

    log.trace('handling ilp prepare. sourceAccount=%s destination=%s amount=%s condition=%s expiry=%s data=%s',
      sourceAccount, destination, amount, executionCondition.toString('base64'), expiresAt.toISOString(), data.toString('base64'))

    if (destination.startsWith(PEER_PROTOCOL_PREFIX)) {
      return this.peerProtocolController.handle(packet, sourceAccount)
    } else if (destination === this.accounts.getOwnAddress()) {
      return this.echoController.handle(packet, sourceAccount, outbound)
    }

    const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket(sourceAccount, packet)

    log.trace('sending outbound ilp prepare. destination=%s amount=%s', destination, nextHopPacket.amount)
    const result = await outbound(nextHopPacket, nextHop)

    if (isFulfill(result)) {
      log.trace('got fulfillment. cond=%s nextHop=%s amount=%s', executionCondition.slice(0, 6).toString('base64'), nextHop, nextHopPacket.amount)

      this.backend.submitPayment({
        sourceAccount: sourceAccount,
        sourceAmount: amount,
        destinationAccount: nextHop,
        destinationAmount: nextHopPacket.amount
      })
        .catch(err => {
          const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : String(err)
          log.error('error while submitting payment to backend. error=%s', errInfo)
        })
    } else {
      log.trace('got rejection. cond=%s nextHop=%s amount=%s code=%s triggeredBy=%s message=%s',
        executionCondition.slice(0, 6).toString('base64'), nextHop, nextHopPacket.amount,
        result.code, result.triggeredBy, result.message)
    }

    return result
  }
}
