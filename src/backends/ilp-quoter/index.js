'use strict'

const request = require('co-request')
const NoAmountSpecifiedError =
  require('../../errors/no-amount-specified-error')
const log = require('../../common').log('ilpquote')
const ServerError = require('five-bells-shared/errors/server-error')
const config = require('../../services/config')
const utils = require('../utils')
const _ = require('lodash')

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
    const ledgerPairs = config.get('tradingPairs')
    if (_.isEmpty(ledgerPairs)) {
      throw new ServerError('No trading pairs found for this connector')
    }
    this.currencyPairs = ledgerPairs.map((p) => [p[0].slice(0, 3),
                                   p[1].slice(0, 3)])
    this.backendUri = config.get('backendUri')
  }

  /**
   * Connect to the backend to get the available currency pairs
   *   and checks that all the pairs are supported
   */
  * connect () {
    const requests = this.currencyPairs.map((pair) => {
      const uri = this.backendUri + '/pair/' + pair[0] + '/' + pair[1]
      return request({ method: 'PUT', uri, json: true })
    })
    const responses = yield requests
    // TODO: report an error if pairs not supported
    return responses
  }

  /**
   * Get an actual quote from the backend. The external
   *   component specified by backendUri will be called with
   *   all amounts encoded as strings. The returned source
   *   and destination amounts must be strings.
   */
  * getQuote (params) {
    log.debug('Connecting to ' + this.backendUri)
    const currencyPair = utils.getCurrencyPair(params.source_ledger,
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
