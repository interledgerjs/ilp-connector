'use strict'

const _ = require('lodash')
const request = require('co-request')
const BigNumber = require('bignumber.js')
const AssetsNotTradedError = require('../../errors/assets-not-traded-error')
const NoAmountSpecifiedError = require('../../errors/no-amount-specified-error')
const log = require('../../services/log')('fixerio')

const CURRENCY_REGEX = /\W([A-Z]{3}|[a-z]{3})/
const RATES_API = 'http://api.fixer.io/latest'

/**
 * Dummy backend that uses Fixer.io API for FX rates
 */
class FixerIoBackend {
  /**
   * Constructor.
   *
   * @param {Integer} opts.spread The spread we will use to mark up the FX rates
   * @param {String} opts.ratesApiUrl The API endpoint we will request rates from
   */
  constructor (opts) {
    if (!opts) {
      opts = {}
    }

    this.spread = opts.spread || 0.002
    // this.ratesCacheTtl = opts.ratesCacheTtl || 24 * 3600000

    this.rates = {}
    this.currencies = []
  }

  /**
   * Get the rates from the API
   *
   * Mock data can be provided for testing purposes
   */
  * connect (mockData) {
    log.debug('connect')

    let apiData
    if (mockData) {
      apiData = mockData
    } else {
      let result = yield request({
        uri: RATES_API,
        json: true
      })
      apiData = result.body
    }

    this.rates = apiData.rates
    this.rates[apiData.base] = 1
    this.currencies = _.keys(this.rates)
    this.currencies.sort()
  }

  /**
   * This is not a good way to parse the currency from
   * a URI but this is just a test module anyway
   *
   * @param {String} uri Ledger URI to parse the currency from
   * @return {String} Three-letter currency code
   */
  _parseCurrency (uri) {
    return CURRENCY_REGEX.exec(uri)[1].toUpperCase()
  }

  /**
   * Check if we trade the given pair of assets
   *
   * @param {String} source The URI of the source ledger
   * @param {String} destination The URI of the destination ledger
   * @return {boolean}
   */
  * hasPair (source, destination) {
    const sourceCurrency = this._parseCurrency(source)
    const destinationCurrency = this._parseCurrency(destination)
    return _.includes(this.currencies, sourceCurrency) &&
      _.includes(this.currencies, destinationCurrency)
  }

  _formatAmount (amount) {
    return new BigNumber(amount).toFixed(2)
  }

  _formatAmountCeil (amount) {
    return new BigNumber(amount).times(100).ceil().div(100).toFixed(2)
  }

  _subtractSpread (amount) {
    return new BigNumber(amount).times(new BigNumber(1).minus(this.spread))
  }

  _addSpread (amount) {
    return new BigNumber(amount).times(new BigNumber(1).plus(this.spread))
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
    // Throw an error if the currency pair is not supported
    const hasPair = yield this.hasPair(params.source_ledger, params.destination_ledger)
    if (!hasPair) {
      console.log('doesnt have pair', params)
      throw new AssetsNotTradedError('This trader does not support the ' +
        'given asset pair')
    }

    // Get ratio between currencies and apply spread
    const destinationRate = this.rates[this._parseCurrency(params.destination_ledger)]
    const sourceRate = this.rates[this._parseCurrency(params.source_ledger)]
    let rate = new BigNumber(destinationRate).div(sourceRate).toFixed(5)

    let sourceAmount, destinationAmount
    if (params.source_amount) {
      log.debug('creating quote with fixed source amount')

      rate = this._subtractSpread(rate)
      sourceAmount = new BigNumber(params.source_amount)
      destinationAmount = new BigNumber(params.source_amount).times(rate)
    } else if (params.destination_amount) {
      log.debug('creating quote with fixed destination amount')

      rate = this._addSpread(rate)
      sourceAmount = new BigNumber(params.destination_amount).div(rate)
      destinationAmount = new BigNumber(params.destination_amount)
    } else {
      throw new NoAmountSpecifiedError('Must specify either source ' +
        'or destination amount to get quote')
    }

    let quote = {
      source_ledger: params.source_ledger,
      destination_ledger: params.destination_ledger,
      source_amount: sourceAmount,
      destination_amount: destinationAmount
    }

    return quote
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

module.exports = FixerIoBackend
