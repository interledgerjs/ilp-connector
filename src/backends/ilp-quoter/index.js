'use strict'

const request = require('co-request')
const AssetsNotTradedError =
  require('../../errors/assets-not-traded-error')
const NoAmountSpecifiedError =
  require('../../errors/no-amount-specified-error')
const UnacceptableQuoterAmountError =
  require('../../errors/unacceptable-quoter-amount-error')
const log = require('../../services/log')('ilpquote')
const config = require('../../services/config')
const BigNumber = require('bignumber.js')

function lookupCurrencies (source_ledger, destination_ledger) {
  for (let pair of config.get('tradingPairs')) {
    if (pair[0].indexOf(source_ledger) === 4 &&
        pair[1].indexOf(destination_ledger) === 4) {
      const currencyA = pair[0].slice(0, 3)
      const currencyB = pair[1].slice(0, 3)
      return [currencyA, currencyB]
    }
  }
  return null
}

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
    const pairs = config.get('tradingPairs')
    this.pairs = pairs.map((p) => [p[0].slice(0, 3),
                                   p[1].slice(0, 3)])
    this.backendUri = config.get('backendUri')
  }

  /**
   * Connect to the backend to get the available currency pairs
   *   and checks that all the pairs are supported
   */
  * connect () {
    const requests = this.pairs.map((pair) => {
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
    const hasPair = yield this.hasPair(params.source_ledger,
                                       params.destination_ledger)
    if (!hasPair) {
      throw new AssetsNotTradedError('This connector does not support the ' +
        'given asset pair')
    }
    const currencyPair = lookupCurrencies(params.source_ledger,
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
    const fixedAmount = type === 'source' ? result.body.source_amount
                                          : result.body.destination_amount
    if (fixedAmount !== amount.toString()) {
      if (!(new BigNumber(fixedAmount).equals(new BigNumber(amount)))) {
        throw new UnacceptableQuoterAmountError('Backend returned an invalid ' +
                  type + ' amount: ' + fixedAmount + ' (expected: ' + amount + ')')
      }
    }
    const quote = {
      source_ledger: params.source_ledger,
      destination_ledger: params.destination_ledger,
      source_amount: result.body.source_amount,
      destination_amount: result.body.destination_amount
    }
    return quote
  }

  * hasPair (source, destination) {
    const pair = lookupCurrencies(source, destination)
    const success = this.pairs.find((p) => (p[0] === pair[0]) && (p[1] === pair[1])) !== undefined
    return success
  }
}

module.exports = ILPQuoter
