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
   * @param {PrecisionCache} precisionCache
   * @param {Object} config
   * @param {Integer} config.minMessageWindow seconds
   * @param {Number} config.slippage
   * @param {Object} config.ledgerCredentials
   */
  constructor (routingTables, precisionCache, config) {
    this.baseURI = routingTables.baseURI
    this.routingTables = routingTables
    this.precisionCache = precisionCache
    this.minMessageWindow = config.minMessageWindow
    this.slippage = config.slippage
    this.ledgerCredentials = config.ledgerCredentials
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
    const _nextHop = this._findNextHop(query)
    if (!_nextHop) throwAssetsNotTradedError()
    if (query.sourceAmount) {
      _nextHop.finalAmount = (new BigNumber(_nextHop.finalAmount)).times(1 - this.slippage).toString()
    } else { // fixed destinationAmount
      _nextHop.sourceAmount = (new BigNumber(_nextHop.sourceAmount)).times(1 + this.slippage).toString()
    }
    const nextHop = yield this._roundHop(_nextHop)

    return {
      source_connector_account: this.ledgerCredentials[nextHop.sourceLedger].account_uri,
      source_ledger: nextHop.sourceLedger,
      source_amount: nextHop.sourceAmount,
      destination_ledger: nextHop.finalLedger,
      destination_amount: nextHop.finalAmount,
      _hop: nextHop
    }
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
    const traderCredit = sourceTransfer.credits.find(this._isTraderFunds, this)
    const finalTransfer = traderCredit.memo && traderCredit.memo.destination_transfer
    if (!finalTransfer) {
      throw new Error('source transfer is missing destination_transfer in memo')
    }

    const sourceLedger = sourceTransfer.ledger
    const finalLedger = finalTransfer.ledger
    const _nextHop = this.routingTables.findBestHopForSourceAmount(
      sourceLedger, finalLedger, traderCredit.amount)
    if (!_nextHop) throwAssetsNotTradedError()
    const nextHop = yield this._roundHop(_nextHop)

    // Check if this connector can authorize the final transfer.
    if (nextHop.destinationLedger === finalLedger) {
      const traderDebit = finalTransfer.debits.find((debit) => !debit.account)
      if (traderDebit) {
        traderDebit.account = nextHop.destinationDebitAccount
      }

      // Verify finalTransfer.credits[0].amount <= nextHop.destinationAmount
      const finalAmount = new BigNumber(finalTransfer.credits[0].amount)
      if (finalAmount.greaterThan(nextHop.destinationAmount)) {
        throw new UnacceptableRateError('Payment rate does not match the rate currently offered')
      }
      // TODO: Verify atomic mode notaries are trusted
      // TODO: Verify expiry is acceptable

      nextHop.destinationCreditAccount = finalTransfer.credits[0].account
      nextHop.destinationAmount = finalTransfer.credits[0].amount
    }

    const noteToSelf = {
      source_transfer_ledger: sourceTransfer.ledger,
      source_transfer_id: sourceTransfer.id
    }

    return _.omitBy({
      // TODO: Use a real secret
      id: nextHop.destinationLedger !== finalLedger
        ? getDeterministicUuid('secret', sourceTransfer.ledger + '/' + sourceTransfer.id)
        : finalTransfer.id.substring(finalTransfer.id.length - 36),
      ledger: nextHop.destinationLedger,
      account: nextHop.destinationCreditAccount,
      amount: nextHop.destinationAmount,
      data: nextHop.destinationLedger !== finalLedger
        ? { destination_transfer: finalTransfer }
        : finalTransfer.credits[0].memo,
      noteToSelf: noteToSelf,
      executionCondition: sourceTransfer.execution_condition,
      cancellationCondition: sourceTransfer.cancellation_condition,
      expiresAt: this._getDestinationExpiry(sourceTransfer.expires_at),
      cases: sourceTransfer.additional_info && sourceTransfer.additional_info.cases
        ? sourceTransfer.additional_info.cases
        : undefined
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
  * _roundHop (hop) {
    hop.sourceAmount = yield this._roundAmount('source', hop.sourceLedger, hop.sourceAmount)
    hop.destinationAmount = yield this._roundAmount('destination', hop.destinationLedger, hop.destinationAmount)
    hop.finalAmount = yield this._roundAmount('destination', hop.finalLedger, hop.finalAmount)
    return hop
  }

  * _roundAmount (sourceOrDestination, ledger, amount) {
    const precisionAndScale = yield this.precisionCache.get(ledger)
    const roundedAmount = new BigNumber(amount).toFixed(precisionAndScale.scale,
      sourceOrDestination === 'source' ? BigNumber.ROUND_UP : BigNumber.ROUND_DOWN)
    validatePrecision(roundedAmount, precisionAndScale.precision, sourceOrDestination)
    return roundedAmount
  }

  _isTraderFunds (funds) {
    return _.some(this.ledgerCredentials, (credentials) => {
      return credentials.account_uri === funds.account
    })
  }
}

function throwAssetsNotTradedError () {
  throw new AssetsNotTradedError('This connector does not support the given asset pair')
}

function validatePrecision (amount, precision, ledger) {
  const bnAmount = new BigNumber(amount)
  if (bnAmount.precision() > precision) {
    throw new UnacceptableAmountError(
      `Amount (${amount}) exceeds ledger precision on ${ledger} ledger`)
  }
  if (bnAmount.lte(0)) {
    throw new UnacceptableAmountError(
      `Quoted ${ledger} is lower than minimum amount allowed`)
  }
}

module.exports = RouteBuilder
