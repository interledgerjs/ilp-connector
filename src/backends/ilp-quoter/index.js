'use strict'

const _ = require('lodash')
const request = require('co-request')
const BigNumber = require('bignumber.js')
const AssetsNotTradedError = 
  require('../../errors/assets-not-traded-error')
const NoAmountSpecifiedError = 
  require('../../errors/no-amount-specified-error')
const UnacceptableQuoterAmountError = 
  require('../../errors/unacceptable-quoter-amount-error')
const log = require('../../services/log')('ilpquote')
const config = require('../../services/config')

function lookupCurrencies (source_ledger, destination_ledger) {
  for (let pair of config.get('tradingPairs').toJS()) {
    if (pair[0].indexOf(source_ledger) === 4 &&
      pair[1].indexOf(destination_ledger) === 4) {
      const pairs = [pair[0].slice(0, 3), pair[1].slice(0, 3)]
      return pairs
    }
  }
  return null
}

/**
 * Example backend that connects to an external component to get
 *   the source and destination amounts
 */
class ILPQuoter {
  constructor (opts) {
    log.warn('ctor')
    const pairs = config.get('tradingPairs').toJS()
    this.pairs = pairs.map((p) => [p[0].slice(0, 3),
                                   p[1].slice(0, 3)])
    log.warn(pairs)
  }

  /**
   * Connect to the backend to get the available currency pairs
   */
  * connect() {
    const body = { pairs: this.pairs }
    log.warn(body)
    const pairsUri = config.get('backend_uri') + '/pairs'
    const pairsReq = yield request({
      method: 'PUT',
      uri: pairsUri,
      body,
      json: true
    })
  }
 
  /**
   * Get an actual quote from the backend
   */
  * getQuote (params) {
    log.warn('Connecting to ' + config.get('backend_uri'))
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
    if(!amount) {
      throw new NoAmountSpecifiedError('Amount was not specified correctly')
    }
    const uri = config.get('backend_uri') + '/quote/'
              + currencyPair[0] + '/' + currencyPair[1] + '/' + amount
              + '?type=' + type
    const result = yield request({ uri, json: true })
    const fixedAmount = type === 'source' ? result.body.source_amount
                                          : result.body.destination_amount
    if(fixedAmount != amount) {
      throw new UnacceptableQuoterAmountError('Backend returned an invalid '
                + type +' amount: ' + fixedAmount + ' (expected: ' + amount + ')')
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
    const r = this.pairs.find((p) => (p[0] === pair[0]) && (p[1] === pair[1])) !== undefined
    return r
  }
}

module.exports = ILPQuoter