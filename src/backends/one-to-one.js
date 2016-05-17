'use strict'

const BigNumber = require('bignumber.js')
const NoAmountSpecifiedError = require('../errors/no-amount-specified-error')
const log = require('../common').log('one-to-one')
const healthStatus = require('../common/health.js')

/**
 * Backend which charges no spread and trades everything one-to-one.
 */
class OneToOneBackend {
  /**
   * Constructor.
   *
   * @param {Integer} opts.spread The spread we will use to mark up the FX rates
   */
  constructor (opts) {
    if (!opts) {
      opts = {}
    }

    this.spread = opts.spread || 0
  }

  /**
   * Nothing to do since this backend is totally static.
   */
  * connect (mockData) {
  }

  /**
   * Get backend status
   */
  * getStatus () {
    return {
      backendStatus: healthStatus.statusOk
    }
  }

  /**
   * Get a quote for the given parameters
   *
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {String|Integer|BigNumber} params.source_amount The amount of the source asset we want to send (either this or the destination_amount must be set)
   * @param {String|Integer|BigNumber} params.destination_amount The amount of the destination asset we want to send (either this or the source_amount must be set)
   */
  * getQuote (params) {
    // The spread is subtracted from the rate when going in either direction,
    // so that the DestinationAmount always ends up being slightly less than
    // the (equivalent) SourceAmount -- regardless of which of the 2 is fixed:
    //
    //   SourceAmount * (1 - Spread) = DestinationAmount
    //
    let rate = new BigNumber(1).minus(this.spread)

    let sourceAmount
    let destinationAmount
    if (params.source_amount) {
      log.debug('creating quote with fixed source amount')
      sourceAmount = new BigNumber(params.source_amount)
      destinationAmount = new BigNumber(params.source_amount).times(rate)
    } else if (params.destination_amount) {
      log.debug('creating quote with fixed destination amount')
      sourceAmount = new BigNumber(params.destination_amount).div(rate)
      destinationAmount = new BigNumber(params.destination_amount)
    } else {
      throw new NoAmountSpecifiedError('Must specify either source ' +
        'or destination amount to get quote')
    }

    return {
      source_ledger: params.source_ledger,
      destination_ledger: params.destination_ledger,
      source_amount: sourceAmount.toString(),
      destination_amount: destinationAmount.toString()
    }
  }

  /**
   * Dummy function because we're not actually going
   * to submit the payment to any real backend, we're
   * just going to execute it on the ledgers we're connected to
   *
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {Integer} params.source_amount The amount of the source asset we want to send
   * @param {Integer} params.destination_amount The amount of the destination asset we want to send
   * @return {Payment}
   */
  * submitPayment (params) {
    return params
  }
}

module.exports = OneToOneBackend
