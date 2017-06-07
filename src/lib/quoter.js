'use strict'

const ILQP = require('ilp').ILQP
const InvalidAmountSpecifiedError = require('../errors/invalid-amount-specified-error')
const IlpError = require('../errors/ilp-error')

class Quoter {
  constructor (ledgers) {
    this.ledgers = ledgers
    this.tables = ledgers.tables
  }

  /**
   * @param {Ledgers} ledgers
   * @param {Object} request
   * @param {IlpAddress} request.sourceAccount
   * @param {IlpAddress} request.destinationAccount
   * @param {String} request.sourceAmount
   * @param {Integer} request.destinationHoldDuration
   * @returns {Object}
   */
  * quoteBySourceAmount (request) {
    if (request.sourceAmount === '0') {
      throw new InvalidAmountSpecifiedError('sourceAmount must be positive')
    }
    return yield this._quoteByAmount(request)
  }

  /**
   * @param {Ledgers} ledgers
   * @param {Object} request
   * @param {IlpAddress} request.sourceAccount
   * @param {IlpAddress} request.destinationAccount
   * @param {String} request.destinationAmount
   * @param {Integer} request.destinationHoldDuration
   * @returns {Object}
   */
  * quoteByDestinationAmount (request) {
    if (request.destinationAmount === '0') {
      throw new InvalidAmountSpecifiedError('destinationAmount must be positive')
    }
    return yield this._quoteByAmount(request)
  }

  * _quoteByAmount (request) {
    const destinationHoldDuration = request.destinationHoldDuration
    const hop = this._findBestHopForAmount(request)
    if (!hop) return null

    // note the confusion between `next`, `destination`, and `final`;
    // `finalAmount` will be renamed to `destinationAmount` later in
    // the hopToQuote function.
    if (hop.sourceAmount && hop.finalAmount) {
      return hopToQuote(hop, destinationHoldDuration)
    }

    // Otherwise, ask a connector closer to the destination.

    let headHop
    const intermediateConnector = hop.destinationCreditAccount
    // Quote by source amount
    if (request.sourceAmount) {
      headHop = this.tables.findBestHopForSourceAmount(
        hop.sourceLedger, intermediateConnector, request.sourceAmount)
    }
    const tailQuote = yield ILQP.quoteByConnector({
      plugin: this.ledgers.getPlugin(hop.destinationLedger),
      connector: intermediateConnector,
      quoteQuery: {
        sourceAmount: request.destinationAmount === undefined ? headHop.destinationAmount : null,
        destinationAmount: request.sourceAmount === undefined ? hop.finalAmount : null,
        destinationAccount: request.destinationAccount,
        destinationHoldDuration
      }
    })
    if (tailQuote.code) throw new IlpError(tailQuote)

    // Quote by destination amount
    if (request.destinationAmount) {
      headHop = this.tables.findBestHopForDestinationAmount(
        hop.sourceLedger, intermediateConnector, tailQuote.sourceAmount)
    }

    return {
      sourceLedger: hop.sourceLedger,
      nextLedger: headHop.destinationLedger,
      sourceAmount: headHop.sourceAmount,
      destinationAmount: tailQuote.destinationAmount,
      sourceHoldDuration: tailQuote.sourceHoldDuration + headHop.minMessageWindow * 1000,
      destinationHoldDuration
    }
  }

  _findBestHopForAmount (query) {
    return query.sourceAmount === undefined
      ? this.tables.findBestHopForDestinationAmount(
          query.sourceAccount, query.destinationAccount, query.destinationAmount)
      : this.tables.findBestHopForSourceAmount(
          query.sourceAccount, query.destinationAccount, query.sourceAmount)
  }
}

function hopToQuote (hop, destinationHoldDuration) {
  return {
    sourceLedger: hop.sourceLedger,
    nextLedger: hop.destinationLedger,
    destinationLedger: hop.finalLedger,
    sourceAmount: hop.sourceAmount,
    destinationAmount: hop.finalAmount,
    sourceHoldDuration: destinationHoldDuration + hop.minMessageWindow * 1000,
    destinationHoldDuration
  }
}

module.exports = Quoter
