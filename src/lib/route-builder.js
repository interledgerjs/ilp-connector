'use strict'
const _ = require('lodash')
const BigNumber = require('bignumber.js')
const AssetsNotTradedError = require('../errors/assets-not-traded-error')
const UnacceptableAmountError = require('../errors/unacceptable-amount-error')
const UnacceptableRateError = require('../errors/unacceptable-rate-error')
const getDeterministicUuid = require('../lib/utils').getDeterministicUuid

class RouteBuilder {
  /**
   * @param {RoutingTables} routingTables
   * @param {InfoCache} infoCache
   * @param {Multiledger} ledgers
   * @param {Object} config
   * @param {Integer} config.minMessageWindow seconds
   * @param {Number} config.slippage
   * @param {Object} config.ledgerCredentials
   */
  constructor (routingTables, infoCache, ledgers, config) {
    this.baseURI = routingTables.baseURI
    this.routingTables = routingTables
    this.infoCache = infoCache
    this.ledgers = ledgers
    this.minMessageWindow = config.minMessageWindow
    this.slippage = config.slippage
  }

  /**
   * @param {Object} query
   * @param {String} query.sourceLedger
   * @param {String} query.sourceAmount
   * @param {String} query.destinationLedger
   * @param {String} query.destinationAmount
   * @returns {Quote}
   */
  * getQuote (query) {
    const info = {}
    const _nextHop = this._findNextHop(query)
    if (!_nextHop) throwAssetsNotTradedError()
    if (query.sourceAmount) {
      const amount = new BigNumber(_nextHop.finalAmount)
      const amountWithSlippage = amount.times(1 - this.slippage)
      _nextHop.finalAmount = amountWithSlippage.toString()
      info.slippage = (amount - amountWithSlippage).toString()
    } else { // fixed destinationAmount
      const amount = new BigNumber(_nextHop.sourceAmount)
      const amountWithSlippage = amount.times(1 + this.slippage)
      _nextHop.sourceAmount = amountWithSlippage.toString()
      info.slippage = (amount - amountWithSlippage).toString()
    }
    // Round in our favor to ensure that the adjustments don't fall off.
    const nextHop = yield this._roundHop(_nextHop, 'up', 'down')

    const quote = {
      source_connector_account:
        this.ledgers.getLedger(nextHop.sourceLedger).getAccount(),
      source_ledger: nextHop.sourceLedger,
      source_amount: nextHop.sourceAmount,
      destination_ledger: nextHop.finalLedger,
      destination_amount: nextHop.finalAmount,
      _hop: nextHop
    }

    if (query.explain) {
      quote.additional_info = _.assign({}, nextHop.additionalInfo, info)
    }

    return quote
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
    const ilpHeader = sourceTransfer.data && sourceTransfer.data.ilp_header
    if (!ilpHeader) {
      throw new Error('source transfer is missing ilp_header in memo')
    }

    const sourceLedger = sourceTransfer.ledger
    const finalLedger = ilpHeader.ledger
    // Use `findBestHopForSourceAmount` since the source amount includes the slippage.
    const _nextHopBySourceAmount = this.routingTables.findBestHopForSourceAmount(
      sourceLedger, finalLedger, sourceTransfer.amount)
    if (!_nextHopBySourceAmount) throwAssetsNotTradedError()
    // Round against ourselves since the quote rate was overestimated in our favor.
    const nextHop = yield this._roundHop(_nextHopBySourceAmount, 'down', 'up')

    // Check if this connector can authorize the final transfer.
    if (nextHop.isFinal) {
      // Verify ilpHeader.amount ≤ nextHop.finalAmount
      const expectedFinalAmount = new BigNumber(ilpHeader.amount)
      if (expectedFinalAmount.greaterThan(nextHop.finalAmount)) {
        throw new UnacceptableRateError('Payment rate does not match the rate currently offered')
      }
      // TODO: Verify atomic mode notaries are trusted
      // TODO: Verify expiry is acceptable

      nextHop.destinationCreditAccount = ilpHeader.account
      nextHop.destinationAmount = ilpHeader.amount
    }

    const noteToSelf = {
      source_transfer_ledger: sourceTransfer.ledger,
      source_transfer_id: sourceTransfer.id
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
      data: nextHop.isFinal ? ilpHeader.data : { ilp_header: ilpHeader },
      noteToSelf: noteToSelf,
      executionCondition: sourceTransfer.executionCondition,
      cancellationCondition: sourceTransfer.cancellationCondition,
      expiresAt: this._getDestinationExpiry(sourceTransfer.expiresAt),
      cases: sourceTransfer.cases
    }, _.isUndefined)
  }

  _findNextHop (query) {
    return query.sourceAmount
      ? this.routingTables.findBestHopForSourceAmount(
          query.sourceLedger, query.destinationLedger, query.sourceAmount)
      : this.routingTables.findBestHopForDestinationAmount(
          query.sourceLedger, query.destinationLedger, query.destinationAmount)
  }

  _getDestinationExpiry (sourceExpiry) {
    if (!sourceExpiry) return
    const sourceExpiryTime = (new Date(sourceExpiry)).getTime()
    const minMessageWindow = this.minMessageWindow * 1000
    return (new Date(sourceExpiryTime - minMessageWindow)).toISOString()
  }

  /**
   * Round the hop's amounts according to the corresponding ledgers' scales/precisions.
   */
  * _roundHop (hop, sourceUpDown, destinationUpDown) {
    hop.sourceAmount = yield this._roundAmount('source', sourceUpDown, hop.sourceLedger, hop.sourceAmount)
    hop.finalAmount = yield this._roundAmount('destination', destinationUpDown, hop.finalLedger, hop.finalAmount)
    hop.destinationAmount = yield this._roundAmount('destination', destinationUpDown, hop.destinationLedger, hop.destinationAmount)
    return hop
  }

  /**
   * Round amounts against the connector's favor. This cancels out part of the
   * connector's rate curve shift by 1/10^scale.
   *
   * @param {String} sourceOrDestination "source" or "destination"
   * @param {String} upOrDown "up" or "down"
   * @param {URI} ledger
   * @param {String} amount
   * @returns {String} rounded amount
   */
  * _roundAmount (sourceOrDestination, upOrDown, ledger, amount) {
    const precisionAndScale = yield this.infoCache.get(ledger)
    const roundedAmount = new BigNumber(amount).toFixed(precisionAndScale.scale,
      upOrDown === 'down' ? BigNumber.ROUND_DOWN : BigNumber.ROUND_UP)
    validatePrecision(roundedAmount, precisionAndScale.precision, ledger, sourceOrDestination)
    return roundedAmount
  }

  _isTraderFunds (funds) {
    return _.some(this.ledgerCredentials, (credentials) => {
      return credentials.account === funds.account
    })
  }
}

function throwAssetsNotTradedError () {
  throw new AssetsNotTradedError('This connector does not support the given asset pair')
}

function validatePrecision (amount, precision, ledger, sourceOrDestination) {
  const bnAmount = new BigNumber(amount)
  if (bnAmount.precision() > precision) {
    throw new UnacceptableAmountError(
      `Amount (${amount}) exceeds ledger precision on ${ledger}`)
  }
  if (bnAmount.lte(0)) {
    throw new UnacceptableAmountError(
      `Quoted ${sourceOrDestination} is lower than minimum amount allowed`)
  }
}

module.exports = RouteBuilder
