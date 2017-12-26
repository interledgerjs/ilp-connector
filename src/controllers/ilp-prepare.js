'use strict'

const IlpPacket = require('ilp-packet')
const log = require('../common').log.create('ilp-prepare')

const Config = require('../services/config')
const Accounts = require('../services/accounts')
const RouteBuilder = require('../services/route-builder')
const RateBackend = require('../services/rate-backend')
const PeerProtocolController = require('../controllers/peer-protocol')

const UnreachableError = require('../errors/unreachable-error')

const { fulfillmentToCondition } = require('../lib/utils')
const { codes } = require('../lib/ilp-errors')

const PEER_PROTOCOL_PREFIX = 'peer.'

class IlpPrepareController {
  constructor (deps) {
    this.config = deps(Config)
    this.accounts = deps(Accounts)
    this.routeBuilder = deps(RouteBuilder)
    this.backend = deps(RateBackend)
    this.peerProtocolController = deps(PeerProtocolController)
  }

  async handle (sourceAccount, packet) {
    log.debug('handling ilp prepare. sourceAccount=%s', sourceAccount)

    try {
      const parsedPacket = IlpPacket.deserializeIlpPrepare(packet)
      const { amount, executionCondition, destination } = parsedPacket

      if (destination.startsWith(PEER_PROTOCOL_PREFIX)) {
        return await this.peerProtocolController.handle(sourceAccount, parsedPacket)
      }

      const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket(sourceAccount, parsedPacket)

      log.debug('sending outbound ilp prepare. destination=%s amount=%s', destination, nextHopPacket.amount)
      const result = await this.sendDataToPeer(nextHop, IlpPacket.serializeIlpPrepare(nextHopPacket))

      if (result[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
        const { fulfillment } = IlpPacket.deserializeIlpFulfill(result)

        if (!fulfillmentToCondition(fulfillment).equals(executionCondition)) {
          log.warn('got invalid fulfillment from peer, not paying. peerAddress=%s', nextHop)

          // We think the fulfillment is invalid, so we'll return a rejection
          throw new UnreachableError('received an invalid fulfillment.')
        }

        log.debug('got fulfillment, paying. cond=%s nextHop=%s amount=%s', executionCondition.slice(0, 6).toString('base64'), nextHop, nextHopPacket.amount)

        // asynchronously send money to peer, we don't want to wait for this
        this.sendMoneyToPeer(nextHop, nextHopPacket.amount)
          .catch(err => {
            const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
            log.warn('sending money to peer failed. peerAddress=%s amount=%s error=%s', nextHop, nextHopPacket.amount, errInfo)
          })
      }

      this.backend.submitPayment({
        sourceAccount: sourceAccount,
        sourceAmount: amount,
        destinationAccount: nextHop,
        destinationAmount: nextHopPacket.amount
      })

      return result
    } catch (err) {
      log.debug('transfer error. error=%s', (err && typeof err === 'object' && err.stack) ? err.stack : err)

      if (err.name === 'InsufficientBalanceError') {
        err.ilpErrorCode = codes.T04_INSUFFICIENT_LIQUIDITY
      }

      return IlpPacket.serializeIlpReject({
        code: err.ilpErrorCode || codes.F00_BAD_REQUEST,
        message: (err && typeof err === 'object' && err.message) ? err.message : String(err),
        triggeredBy: this.config.address
      })
    }
  }

  async sendDataToPeer (address, data) {
    try {
      return await this.accounts.getPlugin(address).sendData(data)
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

  async sendMoneyToPeer (address, amount) {
    return this.accounts.getPlugin(address).sendMoney(amount)
  }
}

module.exports = IlpPrepareController
