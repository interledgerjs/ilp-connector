'use strict'
const _ = require('lodash')
const BigNumber = require('bignumber.js')
const AssetsNotTradedError = require('../errors/assets-not-traded-error')
const UnacceptableAmountError = require('../errors/unacceptable-amount-error')
const UnacceptableRateError = require('../errors/unacceptable-rate-error')
const LedgerNotConnectedError = require('../errors/ledger-not-connected-error')
const getDeterministicUuid = require('../lib/utils').getDeterministicUuid
const log = require('../common/log').create('route-builder')

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
   * @param {Object} [params.destinationPrecisionAndScale]
   * @param {Object} [params.slippage]
   * @returns {Quote}
   */
  * getQuote (params) {
    log.info('creating quote sourceAddress=%s sourceAmount=%s ' +
      'destinationAddress=%s destinationAmount=%s ' +
      'destinationPrecisionAndScale=%s slippage=%s',
      params.sourceAddress, params.sourceAmount,
      params.destinationAddress, params.destinationAmount,
      params.destinationPrecisionAndScale, params.slippage)
    const info = {}
    const quote = yield this.ledgers.quote({
      sourceAddress: params.sourceAddress,
      sourceAmount: params.sourceAmount,
      destinationAddress: params.destinationAddress,
      destinationAmount: params.destinationAmount,
      sourceExpiryDuration: params.sourceExpiryDuration,
      destinationExpiryDuration: params.destinationExpiryDuration,
      destinationPrecisionAndScale: params.destinationPrecisionAndScale
    })
    if (!quote) throwAssetsNotTradedError()
    this._verifyLedgerIsConnected(quote.sourceLedger)
    this._verifyLedgerIsConnected(quote.nextLedger)

    const slippage = params.slippage ? +params.slippage : this.slippage
    if (params.sourceAmount) {
      const amount = new BigNumber(quote.destinationAmount)
      const amountWithSlippage = amount.times(1 - slippage)
      quote.destinationAmount = amountWithSlippage.toString()
      info.slippage = amount.minus(amountWithSlippage).toString()
    } else { // fixed destinationAmount
      const amount = new BigNumber(quote.sourceAmount)
      const amountWithSlippage = amount.times(1 + slippage)
      quote.sourceAmount = amountWithSlippage.toString()
      info.slippage = amount.minus(amountWithSlippage).toString()
    }

    // Round in favor of the connector (source amount up; destination amount down)
    // to ensure it doesn't lose any money. The amount is quoted using the unshifted rate.
    const roundedSourceAmount = this._roundAmount(
      'source', 'up', quote.sourceLedger, quote.sourceAmount)
    const roundedDestinationAmount = this._roundAmount(
      'destination', 'down', quote.destinationLedger, quote.destinationAmount,
      params.destinationPrecisionAndScale || quote.destinationPrecisionAndScale)

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
      'sourceLedger=%s sourceAmount=%s ilpHeader=%s',
      sourceTransfer.ledger, sourceTransfer.amount,
      sourceTransfer.data && JSON.stringify(sourceTransfer.data.ilp_header))
    const ilpHeader = sourceTransfer.data && sourceTransfer.data.ilp_header
    if (!ilpHeader) {
      throw new Error('source transfer is missing ilp_header in memo')
    }

    const sourceLedger = sourceTransfer.ledger
    // Use `findBestHopForSourceAmount` since the source amount includes the slippage.
    const nextHop = this.routingTables.findBestHopForSourceAmount(
      sourceLedger, ilpHeader.account, sourceTransfer.amount)
    if (!nextHop) throwAssetsNotTradedError()
    this._verifyLedgerIsConnected(nextHop.destinationLedger)

    // Round in favor of the connector. findBestHopForSourceAmount uses the
    // local (unshifted) routes to compute the amounts, so the connector rounds
    // in its own favor to ensure it won't lose money.
    nextHop.destinationAmount = this._roundAmount('destination', 'down',
      nextHop.destinationLedger, nextHop.destinationAmount)

    // Check if this connector can authorize the final transfer.
    if (nextHop.isFinal) {
      const roundedFinalAmount = this._roundAmount('destination', 'down',
        nextHop.finalLedger, nextHop.finalAmount)
      // Verify ilpHeader.amount ≤ nextHop.finalAmount
      const expectedFinalAmount = new BigNumber(ilpHeader.amount)
      if (expectedFinalAmount.greaterThan(roundedFinalAmount)) {
        throw new UnacceptableRateError('Payment rate does not match the rate currently offered')
      }
      // TODO: Verify atomic mode notaries are trusted
      // TODO: Verify expiry is acceptable

      nextHop.destinationCreditAccount = ilpHeader.account
      nextHop.destinationAmount = ilpHeader.amount
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
      data: { ilp_header: ilpHeader },
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
   * @param {IlpAddress} ledger
   * @param {String} amount
   * @param {Object} [_precisionAndScale]
   * @returns {String} rounded amount
   */
  _roundAmount (sourceOrDestination, upOrDown, ledger, amount, _precisionAndScale) {
    const plugin = this.ledgers.getPlugin(ledger)
    if (!_precisionAndScale && !plugin) return amount
    const precisionAndScale = _precisionAndScale || plugin.getInfo()
    const roundingMode = upOrDown === 'down' ? BigNumber.ROUND_DOWN : BigNumber.ROUND_UP

    const bnAmount = new BigNumber(amount)
    const requiredPrecisionRounding = bnAmount.precision() - precisionAndScale.precision
    const requiredScaleRounding = bnAmount.decimalPlaces() - precisionAndScale.scale

    const roundedAmount =
      (requiredPrecisionRounding > requiredScaleRounding)
      ? bnAmount.toPrecision(precisionAndScale.precision, roundingMode)
      : bnAmount.toFixed(precisionAndScale.scale, roundingMode)

    validateAmount(roundedAmount, ledger, sourceOrDestination)
    return roundedAmount
  }

  _verifyLedgerIsConnected (ledger) {
    if (!this.ledgers.getPlugin(ledger).isConnected()) {
      throw new LedgerNotConnectedError('No connection to ledger "' + ledger + '"')
    }
  }
}

function throwAssetsNotTradedError () {
  throw new AssetsNotTradedError('This connector does not support the given asset pair')
}

function validateAmount (amount, ledger, sourceOrDestination) {
  const bnAmount = new BigNumber(amount)
  if (bnAmount.lte(0)) {
    throw new UnacceptableAmountError(
      `Quoted ${sourceOrDestination} is lower than minimum amount allowed`)
  }
}

module.exports = RouteBuilder
