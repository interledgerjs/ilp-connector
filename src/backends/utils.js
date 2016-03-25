'use strict'

const _ = require('lodash')
const config = require('../services/config')

function getCurrencyPair (source_ledger, destination_ledger) {
  if (!_.isEmpty(config.get('tradingPairs'))) {
    for (let pair of config.get('tradingPairs')) {
      // trading pair is of the form
      // ["<currency@<source_ledger>","<currency>@<destination_ledger>"]
      if (pair[0].indexOf(source_ledger) === 4 &&
        pair[1].indexOf(destination_ledger) === 4) {
        return [pair[0].slice(0, 3), pair[1].slice(0, 3)]
      }
    }
  }
  // No currency pair found
  return ['', '']
}

/**
 * Check if we trade the given pair of assets
 *
 * @param {String} source The URI of the source ledger
 * @param {String} destination The URI of the destination ledger
 * @return {boolean}
 */
function hasPair (currencyPairs, source, destination) {
  const currencyPair = getCurrencyPair(source, destination)
  return _.includes(currencyPairs, currencyPair[0]) &&
    _.includes(currencyPairs, currencyPair[1])
}

module.exports = {
  getCurrencyPair,
  hasPair
}
