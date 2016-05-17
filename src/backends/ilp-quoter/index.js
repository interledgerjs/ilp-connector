'use strict'

const _ = require('lodash')
const request = require('co-request')
const NoAmountSpecifiedError =
  require('../../errors/no-amount-specified-error')
const UnsupportedPairError =
  require('../../errors/unsupported-pair-error')
const log = require('../../common').log('ilpquoter')
const ServerError = require('five-bells-shared/errors/server-error')
const utils = require('../utils')
const healthStatus = require('../../common/health.js')

/**
 * Example backend that connects to an external component to get
 *   the source and destination amounts
 * The ILP quoter doesn't do any arithmetic -- it's up to the external
 *   component to compute the correct amounts with the required
 *   precision. So amounts are passed using JSON strings
 */
class ILPQuoter {
  constructor (opts) {
    log.debug('ILPQuoter ctor')
    this.currencyWithLedgerPairs = opts.currencyWithLedgerPairs
    this.currencyPairs = this.currencyWithLedgerPairs.map((p) => [p[0].slice(0, 3),
                                                                  p[1].slice(0, 3)])
    this.backendUri = opts.backendUri
    this.backendStatus = healthStatus.statusNotOk
  }

  * putPair (uri) {
    const req = request({ method: 'PUT', uri, json: true })
    const res = yield req
    if (res.statusCode >= 400) {
      throw new UnsupportedPairError(req.uri)
    }
  }

  /**
   * Connect to the backend to get the available currency pairs
   *   and checks that all the pairs are supported
   */
  * connect () {
    const uris = _.uniq(this.currencyPairs.map((pair) => this.backendUri + '/pair/' + pair[0] + '/' + pair[1]))
    yield uris.map((uri) => this.putPair(uri))
    this.backendStatus = healthStatus.statusOk
    return
  }

  /**
   * Get backend status
   */
  * getStatus () {
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
   */
  * getQuote (params) {
    log.debug('Connecting to ' + this.backendUri)
    const currencyPair = utils.getCurrencyPair(this.currencyWithLedgerPairs,
                                               params.source_ledger,
                                               params.destination_ledger)
    let amount, type
    if (params.source_amount) {
      amount = params.source_amount
      type = 'source'
    }
    if (params.destination_amount) {
      amount = params.destination_amount
      type = 'destination'
    }
    if (!amount) {
      throw new NoAmountSpecifiedError('Amount was not specified correctly')
    }
    const uri = this.backendUri + '/quote/' +
                currencyPair[0] + '/' + currencyPair[1] + '/' + amount +
                '/' + type
    const result = yield request({ uri, json: true })
    if (result.statusCode >= 400) {
      log.error('Error getting quote: ', JSON.stringify(result.body))
      throw new ServerError('Unable to get quote from backend.')
    }
    const quote = {
      source_ledger: params.source_ledger,
      destination_ledger: params.destination_ledger,
      source_amount: result.body.source_amount,
      destination_amount: result.body.destination_amount
    }
    return quote
  }
}

module.exports = ILPQuoter
