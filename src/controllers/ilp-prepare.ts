'use strict'

import * as IlpPacket from 'ilp-packet'
import { create as createLogger } from '../common/log'
const log = createLogger('ilp-prepare')
import reduct = require('reduct')

import Config from '../services/config'
import Accounts from '../services/accounts'
import RouteBuilder from '../services/route-builder'
import RateBackend from '../services/rate-backend'
import PeerProtocolController from '../controllers/peer-protocol'

import UnreachableError from '../errors/unreachable-error'

const { fulfillmentToCondition } = require('../lib/utils')
const { codes } = require('../lib/ilp-errors')

const PEER_PROTOCOL_PREFIX = 'peer.'

export default class IlpPrepareController {
  protected config: Config
  protected accounts: Accounts
  protected routeBuilder: RouteBuilder
  protected backend: RateBackend
  protected peerProtocolController: PeerProtocolController

  constructor (deps: reduct.Injector) {
    this.config = deps(Config)
    this.accounts = deps(Accounts)
    this.routeBuilder = deps(RouteBuilder)
    this.backend = deps(RateBackend)
    this.peerProtocolController = deps(PeerProtocolController)
  }

  async handle (sourceAccount: string, packet: Buffer) {
    const parsedPacket = IlpPacket.deserializeIlpPrepare(packet)
    const { amount, executionCondition, destination, expiresAt } = parsedPacket

    log.debug('handling ilp prepare. sourceAccount=%s destination=%s amount=%s condition=%s expiry=%s packet=%s', sourceAccount, destination, amount, executionCondition.toString('base64'), expiresAt.toISOString(), packet.toString('base64'))

    if (destination.startsWith(PEER_PROTOCOL_PREFIX)) {
      return this.peerProtocolController.handle(sourceAccount, packet, { parsedPacket })
    }

    const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket(sourceAccount, parsedPacket)

    log.debug('sending outbound ilp prepare. destination=%s amount=%s', destination, nextHopPacket.amount)
    const result = await this.sendDataToPeer(nextHop, IlpPacket.serializeIlpPrepare(nextHopPacket))

    if (result[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
      const { fulfillment } = IlpPacket.deserializeIlpFulfill(result)

      if (!fulfillmentToCondition(fulfillment).equals(executionCondition)) {
        log.warn('got invalid fulfillment from peer, not paying. peerId=%s', nextHop)

        // We think the fulfillment is invalid, so we'll return a rejection
        throw new UnreachableError('received an invalid fulfillment.')
      }

      log.debug('got fulfillment, paying. cond=%s nextHop=%s amount=%s', executionCondition.slice(0, 6).toString('base64'), nextHop, nextHopPacket.amount)

      // asynchronously send money to peer, we don't want to wait for this
      this.sendMoneyToPeer(nextHop, nextHopPacket.amount)
        .catch(err => {
          const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
          log.warn('sending money to peer failed. peerId=%s amount=%s error=%s', nextHop, nextHopPacket.amount, errInfo)
        })

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

  async sendDataToPeer (peerId: string, data: Buffer) {
    try {
      return await this.accounts.getPlugin(peerId).sendData(data)
    } catch (err) {
      if (err && typeof err === 'object') {
        const newError = new UnreachableError('failed to forward ilp prepare: ' + err.message)
        if (err.stack) {
          newError.stack = err.stack
        }
        throw newError
      } else {
        throw new Error('non-object thrown: ' + err)
      }
    }
  }

  async sendMoneyToPeer (peerId: string, amount: string) {
    return this.accounts.getPlugin(peerId).sendMoney(amount)
  }
}
