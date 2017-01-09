'use strict'

const BigNumber = require('bignumber.js')
const healthStatus = require('../common/health.js')
// This simple backend uses a fixed (large) source amount and a rate to generate
// the destination amount for the curve.
const PROBE_SOURCE_AMOUNT = 100000000

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
   * Get a liquidity curve for the given parameters.
   *
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {String} params.source_currency The source currency
   * @param {String} params.destination_currency The destination currency
   * @returns {Object}
   */
  * getCurve (params) {
    // The spread is subtracted from the rate when going in either direction,
    // so that the DestinationAmount always ends up being slightly less than
    // the (equivalent) SourceAmount -- regardless of which of the 2 is fixed:
    //
    //   SourceAmount * (1 - Spread) = DestinationAmount
    //
    const rate = new BigNumber(1).minus(this.spread)
    const sourceAmount = PROBE_SOURCE_AMOUNT
    const destinationAmount = new BigNumber(sourceAmount).times(rate).toString()
    return { points: [[0, 0], [ sourceAmount, +destinationAmount ]] }
  }

  /**
   * Dummy function because we're not actually going
   * to submit the payment to any real backend, we're
   * just going to execute it on the ledgers we're connected to
   *
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {String} params.source_amount The amount of the source asset we want to send
   * @param {String} params.destination_amount The amount of the destination asset we want to send
   * @return {Promise.<null>}
   */
  submitPayment (params) {
    return Promise.resolve(null)
  }
}

module.exports = OneToOneBackend
