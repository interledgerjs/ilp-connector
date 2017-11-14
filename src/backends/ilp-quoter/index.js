'use strict'

const _ = require('lodash')
const BigNumber = require('bignumber.js')
const request = require('co-request')
const UnsupportedPairError =
  require('../../errors/unsupported-pair-error')
const log = require('../../common').log.create('ilpquoter')
const ServerError = require('five-bells-shared/errors/server-error')
const utils = require('../utils')
const healthStatus = require('../../common/health.js')
// This simple backend uses a fixed (large) source amount and a rate to generate
// the destination amount for the curve.
const PROBE_SOURCE_AMOUNT = new BigNumber(10).pow(14) // stays within 15 max digits for BigNumber from Number

/**
 * Example backend that connects to an external component to get
 *   the source and destination amounts
 * The ILP quoter doesn't do any arithmetic -- it's up to the external
 *   component to compute the correct amounts with the required
 *   precision. So amounts are passed using JSON strings.
 * Quote precision is a constructor option of this Backend.
 * Currency codes are specified in construction option currencyWithLedgerPairs
 * Currency scale is specified by the ledger plugin for each legder.
 */
class ILPQuoter {
  constructor (opts) {
    log.debug('ILPQuoter ctor')
    this.currencyWithLedgerPairs = opts.currencyWithLedgerPairs
    this.currencyPairs = this.currencyWithLedgerPairs.map((p) => [
      p[0].slice(0, 3),
      p[1].slice(0, 3)
    ])
    this.backendUri = opts.backendUri
    this.backendStatus = healthStatus.statusNotOk
    this.getInfo = opts.getInfo
    this.quotePrecision = opts.quotePrecision
  }

  async putPair (uri) {
    const req = request({ method: 'PUT', uri, json: true })
    const res = await req
    const result = {
      success: true,
      errorMessage: undefined
    }
    if (res.statusCode >= 400) {
      result.success = false
      result.errorMessage = uri
      log.debug('Unsupported pair, the quoter reported a ' + res.statusCode + ' status on PUT ' + uri)
      log.debug(res.body)
    }
    return result
  }

  /**
   * Connect to the backend to get the available currency pairs
   *   and checks that all the pairs are supported
   */
  async connect () {
    const uris = _.uniq(this.currencyPairs.map((pair) => this.backendUri + '/pair/' + pair[0] + '/' + pair[1]))
    const results = await Promise.all(uris.map((uri) => this.putPair(uri)))
    const success = _.every(results, (result) => result.success)
    if (!success) {
      const message = _.reduce(results, (msg, result) => result.success ? msg : msg + result.errorMessage + ' ', '')
      throw new UnsupportedPairError(message)
    }
    this.backendStatus = success ? healthStatus.statusOk : healthStatus.statusNotOk
  }

  /**
   * Get backend status
   */
  async getStatus () {
    const status = {
      backendStatus: this.backendStatus
    }
    return status
  }

  /**
   * Get an actual quote from the backend. The external
   *   component specified by backendUri will be called with
   *   all amounts encoded as strings. The returned source
   *   and destination amounts must be strings.
   *
   * The quote is used locally to generate a liquidity curve.
   */
  async getCurve (params) {
    log.debug('Connecting to ' + this.backendUri)
    const currencyPair = utils.getCurrencyPair(this.currencyWithLedgerPairs,
                                               params.source_ledger,
                                               params.destination_ledger)
    const sourceScale = this.getInfo(params.source_ledger).currencyScale
    const destinationInfo = this.getInfo(params.destination_ledger)
    const destinationScale = destinationInfo.currencyScale
    const amount = PROBE_SOURCE_AMOUNT.shift(-Math.max(sourceScale, destinationScale))
    const type = 'source'

    const uri = this.backendUri + '/quote/' +
                currencyPair[0] + '/' + currencyPair[1] + '/' + amount +
                '/' + type

    const result = await request({
      uri,
      json: true,
      qs: {
        precision: this.quotePrecision,
        scale: destinationScale
      }
    })
    if (result.statusCode >= 400) {
      log.error('Error getting quote: ', JSON.stringify(result.body))
      throw new ServerError('Unable to get quote from backend.')
    }
    return {
      points: [
        [0, 0],
        [
          new BigNumber(result.body.source_amount).shift(sourceScale).toNumber(),
          new BigNumber(result.body.destination_amount).shift(destinationScale).toNumber()
        ]
      ],
      additional_info: result.body.additional_info
    }
  }
}

module.exports = ILPQuoter
