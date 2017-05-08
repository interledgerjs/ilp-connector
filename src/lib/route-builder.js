'use strict'
const _ = require('lodash')
const BigNumber = require('bignumber.js')
const packet = require('ilp-packet')
const routing = require('ilp-routing')
const NoRouteFoundError = require('../errors/no-route-found-error')
const UnacceptableAmountError = require('../errors/unacceptable-amount-error')
const LedgerNotConnectedError = require('../errors/ledger-not-connected-error')
const IlpError = require('../errors/ilp-error')
const getDeterministicUuid = require('../lib/utils').getDeterministicUuid
const log = require('../common/log').create('route-builder')
const startsWith = require('lodash/startsWith')

class RouteBuilder {
  /**
   * @param {RoutingTables} routingTables
   * @param {Ledgers} ledgers
   * @param {Object} config
   * @param {Integer} config.minMessageWindow seconds
   * @param {Number} config.slippage
   * @param {Object} config.ledgerCredentials
   */
  constructor (routingTables, ledgers, config) {
    if (!ledgers) {
      throw new TypeError('Must be given a valid Ledgers instance')
    }

    this.routingTables = routingTables
    this.ledgers = ledgers
    this.minMessageWindow = config.minMessageWindow
    this.slippage = config.slippage
  }

  /**
   * @param {Object} params
   * @param {String} params.sourceAddress
   * @param {String} [params.sourceAmount]
   * @param {Number} [params.sourceExpiryDuration]
   * @param {String} params.destinationAddress
   * @param {String} [params.destinationAmount]
   * @param {Number} [params.destinationExpiryDuration]
   * @param {Object} [params.slippage]
   * @returns {Quote}
   */
  * getQuote (params) {
    log.info('creating quote sourceAddress=%s sourceAmount=%s ' +
      'destinationAddress=%s destinationAmount=%s slippage=%s',
      params.sourceAddress, params.sourceAmount,
      params.destinationAddress, params.destinationAmount, params.slippage)
    const info = {}
    const quote = yield this.ledgers.quote({
      sourceAddress: params.sourceAddress,
      sourceAmount: params.sourceAmount,
      destinationAddress: params.destinationAddress,
      destinationAmount: params.destinationAmount,
      sourceExpiryDuration: params.sourceExpiryDuration,
      destinationExpiryDuration: params.destinationExpiryDuration
    })
    if (!quote) {
      log.info('no quote found for params: ' + JSON.stringify(params))
      log.debug('current routing tables (simplified to 10 points): ' + JSON.stringify(this.routingTables.toJSON(10)))
      throw new NoRouteFoundError('No route found from: ' + params.sourceAddress + ' to: ' + params.destinationAddress)
    }
    this._verifyLedgerIsConnected(quote.sourceLedger)
    this._verifyLedgerIsConnected(quote.nextLedger)

    const slippage = params.slippage ? +params.slippage : this.slippage
    // "curve" may or may not be provided on the quote.
    const curve = quote.liquidityCurve && new routing.LiquidityCurve(quote.liquidityCurve)
    if (params.sourceAmount) {
      const amount = new BigNumber(quote.destinationAmount)
      const amountWithSlippage = amount.times(1 - slippage)
      quote.destinationAmount = amountWithSlippage.toString()
      info.slippage = amount.minus(amountWithSlippage).toString()
      quote.liquidityCurve = curve && curve.shiftY(-info.slippage).getPoints()
    } else { // fixed destinationAmount
      const amount = new BigNumber(quote.sourceAmount)
      const amountWithSlippage = amount.times(1 + slippage)
      quote.sourceAmount = amountWithSlippage.toString()
      info.slippage = amount.minus(amountWithSlippage).toString()
      quote.liquidityCurve = curve && curve.shiftX(-info.slippage).getPoints()
    }

    // Round in favor of the connector (source amount up; destination amount down)
    // to ensure it doesn't lose any money. The amount is quoted using the unshifted rate.
    const roundedSourceAmount = this._roundAmount('source', 'up', quote.sourceAmount)
    const roundedDestinationAmount = this._roundAmount('destination', 'down', quote.destinationAmount)

    return _.omitBy(Object.assign(quote, {
      sourceAmount: roundedSourceAmount,
      destinationAmount: roundedDestinationAmount,
      sourceExpiryDuration: quote.sourceExpiryDuration.toString(),
      destinationExpiryDuration: quote.destinationExpiryDuration.toString(),
      additionalInfo: _.assign({}, quote.additionalInfo, info)
    }), _.isUndefined)
  }

  /**
   * Given a source transfer with an embedded final transfer, get the next
   * transfer in the chain.
   *
   * It works as follows:
   * Given `sourceTransfer` A→C, find the next hop B on the route from A to C.
   * If the next hop is the final one (B == C), return the final transfer.
   * Otherwise, return a transfer at B, with the final transfer C embedded.
   *
   * @param {Transfer} sourceTransfer
   * @returns {Transfer} destinationTransfer
   */
  * getDestinationTransfer (sourceTransfer) {
    log.info('constructing destination transfer ' +
      'sourceLedger=%s sourceAmount=%s ilpPacket=%s',
      sourceTransfer.ledger, sourceTransfer.amount, sourceTransfer.ilp)
    if (!sourceTransfer.ilp) {
      throw new IlpError({
        code: 'S01',
        name: 'Invalid Packet',
        message: 'source transfer is missing "ilp"'
      })
    }
    let ilpPacket
    try {
      ilpPacket = packet.deserializeIlpPayment(Buffer.from(sourceTransfer.ilp, 'base64'))
    } catch (err) {
      log.debug('error parsing ILP packet: ' + sourceTransfer.ilp)
      throw new IlpError({
        code: 'S01',
        name: 'Invalid Packet',
        message: 'source transfer has invalid ILP packet'
      })
    }
    const destinationAddress = ilpPacket.account
    const myAddress = this.ledgers.getPlugin(sourceTransfer.ledger).getAccount()
    if (startsWith(destinationAddress, myAddress)) {
      log.debug(
        'ignoring transfer addressed to destination which starts with my address destination=%s me=%s',
        destinationAddress,
        myAddress
      )
      return
    }

    log.debug('constructing transfer for ILP packet with account=%s amount=%s',
      ilpPacket.account, ilpPacket.amount)

    const sourceLedger = sourceTransfer.ledger
    // Use `findBestHopForSourceAmount` since the source amount includes the slippage.
    const nextHop = this.routingTables.findBestHopForSourceAmount(
      sourceLedger, ilpPacket.account, sourceTransfer.amount)
    if (!nextHop) {
      log.info('could not find route for source transfer: ' + JSON.stringify(sourceTransfer))
      log.debug('current routing tables (simplified to 10 points): ' + JSON.stringify(this.routingTables.toJSON(10)))
      throw new IlpError({
        code: 'S02',
        name: 'Unreachable',
        message: 'No route found from: ' + sourceLedger + ' to: ' + ilpPacket.account
      })
    }
    this._verifyLedgerIsConnected(nextHop.destinationLedger)

    // Round in favor of the connector. findBestHopForSourceAmount uses the
    // local (unshifted) routes to compute the amounts, so the connector rounds
    // in its own favor to ensure it won't lose money.
    nextHop.destinationAmount = this._roundAmount('destination', 'down', nextHop.destinationAmount)

    // Check if this connector can authorize the final transfer.
    if (nextHop.isFinal) {
      const roundedFinalAmount = this._roundAmount('destination', 'down', nextHop.finalAmount)
      // Verify ilpPacket.amount ≤ nextHop.finalAmount
      const expectedFinalAmount = new BigNumber(ilpPacket.amount)
      if (expectedFinalAmount.greaterThan(roundedFinalAmount)) {
        throw new IlpError({
          code: 'R02',
          name: 'Insufficient Source Amount',
          message: 'Payment rate does not match the rate currently offered'
        })
      }
      // TODO: Verify atomic mode notaries are trusted
      // TODO: Verify expiry is acceptable

      nextHop.destinationCreditAccount = ilpPacket.account
      nextHop.destinationAmount = ilpPacket.amount
    }

    const noteToSelf = {
      source_transfer_ledger: sourceTransfer.ledger,
      source_transfer_id: sourceTransfer.id,
      source_transfer_amount: sourceTransfer.amount
    }

    return _.omitBy({
      // The ID for the next transfer should be deterministically generated, so
      // that the connector doesn't send duplicate outgoing transfers if it
      // receives duplicate notifications.
      //
      // The deterministic generation should ideally be impossible for a third
      // party to predict. Otherwise an attacker might be able to squat on a
      // predicted ID in order to interfere with a payment or make a connector
      // look unreliable. In order to assure this, the connector may use a
      // secret that seeds the deterministic ID generation.
      // TODO: Use a real secret
      id: getDeterministicUuid('secret', sourceTransfer.ledger + '/' + sourceTransfer.id),
      ledger: nextHop.destinationLedger,
      direction: 'outgoing',
      account: nextHop.destinationCreditAccount,
      amount: nextHop.destinationAmount,
      ilp: sourceTransfer.ilp,
      noteToSelf,
      executionCondition: sourceTransfer.executionCondition,
      cancellationCondition: sourceTransfer.cancellationCondition,
      expiresAt: this._getDestinationExpiry(sourceTransfer.expiresAt),
      cases: sourceTransfer.cases
    }, _.isUndefined)
  }

  _getDestinationExpiry (sourceExpiry) {
    if (!sourceExpiry) return
    const sourceExpiryTime = (new Date(sourceExpiry)).getTime()
    const minMessageWindow = this.minMessageWindow * 1000
    return (new Date(sourceExpiryTime - minMessageWindow)).toISOString()
  }

  /**
   * Round amounts against the connector's favor. This cancels out part of the
   * connector's rate curve shift by 1/10^scale.
   *
   * @param {String} sourceOrDestination "source" or "destination"
   * @param {String} upOrDown "up" or "down"
   * @param {String} amount
   * @returns {String} rounded amount
   */
  _roundAmount (sourceOrDestination, upOrDown, amount) {
    const roundingMode = upOrDown === 'down' ? BigNumber.ROUND_DOWN : BigNumber.ROUND_UP
    const bnAmount = new BigNumber(amount)
    const roundedAmount = bnAmount.toFixed(0, roundingMode)
    validateAmount(roundedAmount, sourceOrDestination)
    return roundedAmount
  }

  _verifyLedgerIsConnected (ledger) {
    if (!this.ledgers.getPlugin(ledger).isConnected()) {
      throw new LedgerNotConnectedError('No connection to ledger "' + ledger + '"')
    }
  }
}

function validateAmount (amount, sourceOrDestination) {
  const bnAmount = new BigNumber(amount)
  if (bnAmount.lte(0)) {
    throw new UnacceptableAmountError(
      `Quoted ${sourceOrDestination} is lower than minimum amount allowed`)
  }
}

module.exports = RouteBuilder
