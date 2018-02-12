import * as IlpPacket from 'ilp-packet'
import { create as createLogger } from '../common/log'
const log = createLogger('ilp-prepare')
import reduct = require('reduct')

import Accounts from '../services/accounts'
import RouteBuilder from '../services/route-builder'
import RateBackend from '../services/rate-backend'
import PeerProtocolController from '../controllers/peer-protocol'
import EchoController from '../controllers/echo'

import UnreachableError from '../errors/unreachable-error'

const { sha256 } = require('../lib/utils')

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

  async sendData (
    packet: Buffer,
    sourceAccount: string,
    outbound: (data: Buffer, accountId: string) => Promise<Buffer>
  ) {
    const parsedPacket = IlpPacket.deserializeIlpPrepare(packet)
    const { amount, executionCondition, destination, expiresAt } = parsedPacket

    log.debug('handling ilp prepare. sourceAccount=%s destination=%s amount=%s condition=%s expiry=%s packet=%s', sourceAccount, destination, amount, executionCondition.toString('base64'), expiresAt.toISOString(), packet.toString('base64'))

    if (destination.startsWith(PEER_PROTOCOL_PREFIX)) {
      return this.peerProtocolController.handle(packet, sourceAccount, { parsedPacket })
    } else if (destination === this.accounts.getOwnAddress()) {
      return this.echoController.handle(packet, sourceAccount, { parsedPacket, outbound })
    }

    const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket(sourceAccount, parsedPacket)

    log.debug('sending outbound ilp prepare. destination=%s amount=%s', destination, nextHopPacket.amount)
    const result = await outbound(IlpPacket.serializeIlpPrepare(nextHopPacket), nextHop)

    if (result[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
      const { fulfillment } = IlpPacket.deserializeIlpFulfill(result)

      if (!sha256(fulfillment).equals(executionCondition)) {
        log.warn('got invalid fulfillment from peer, not paying. peerId=%s', nextHop)

        // We think the fulfillment is invalid, so we'll return a rejection
        throw new UnreachableError('received an invalid fulfillment.')
      }

      log.debug('got fulfillment. cond=%s nextHop=%s amount=%s', executionCondition.slice(0, 6).toString('base64'), nextHop, nextHopPacket.amount)

      this.backend.submitPayment({
        sourceAccount: sourceAccount,
        sourceAmount: amount,
        destinationAccount: nextHop,
        destinationAmount: nextHopPacket.amount
      })
        .catch(err => {
          const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : String(err)
          log.warn('error while submitting payment to backend. error=%s', errInfo)
        })
    }

    return result
  }
}
