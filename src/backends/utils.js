'use strict'

const _ = require('lodash')
const AssetsNotTradedError = require('../errors/assets-not-traded-error')

/**
 * Return currency pair for ledgers
 *
 * @param {Array} pairs
 * @param {String} source The URI of the source ledger
 * @param {String} destination The URI of the destination ledger
 * @return {Array}
 */
function getCurrencyPair (pairs, sourceLedger, destinationLedger) {
  if (!_.isEmpty(pairs)) {
    for (let pair of pairs) {
      // trading pair is of the form
      // ["<currency@<source_ledger>","<currency>@<destination_ledger>"]
      if (pair[0].indexOf(sourceLedger) === 4 &&
        pair[1].indexOf(destinationLedger) === 4) {
        return [pair[0].slice(0, 3), pair[1].slice(0, 3)]
      }
    }
  }
  throw new AssetsNotTradedError('This connector does not support the ' +
        'given asset pair')
}

module.exports = {
  getCurrencyPair
}
