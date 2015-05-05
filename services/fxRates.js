'use strict';
const _ = require('lodash');
const request = require('co-request');
const config = require('./config');
const AssetsNotTradedError = require('../errors/assets-not-traded-error');

// If the fxRatesApi is changed, make sure to change the tests
// because another feed will likely have a different data format
exports.fxRatesApi = 'http://api.fixer.io/latest';
exports.spread = 0.002;

// function tradesPair(base_asset, base_ledger, cross_asset, cross_ledger) {
//   let pair = [
//     base_asset + '@' + base_ledger,
//     cross_asset + '@' + cross_ledger
//   ];
//   console.log('looking up:', pair);
//   return _.includes(config.tradingPairs, pair);
// }

function lookupCurrencies(source_ledger, destination_ledger) {
  for (let pair of config.tradingPairs) {
    if (pair[0].indexOf(source_ledger) === 4 &&
      pair[1].indexOf(destination_ledger) === 4) {

      return [pair[0].slice(0, 3), pair[1].slice(0, 3)];
    }
  }
  return null;
}

// TODO: actually limit the rates returned to the ledgers we have assets on
exports.get = function *get(source_ledger, destination_ledger) {

  let result = yield request({
    uri: exports.fxRatesApi,
    json: true
  });
  let body = result.body;
  let rates = body.rates;
  let baseCurrency = body.base;

  let currencies = Object.keys(rates);
  currencies.push(baseCurrency);

  let currencyPair = lookupCurrencies(source_ledger, destination_ledger);

  // Throw an error if the currency pair is not supported
  if (!currencyPair ||
    !_.includes(currencies, currencyPair[0]) ||
    !_.includes(currencies, currencyPair[1])) {
    throw new AssetsNotTradedError('This trader does not support the ' +
      'given asset pair');
  }

  // If one of the chosen assets if the base, the rate is already included
  if (currencyPair[0] === baseCurrency) {
    return rates[currencyPair[1]] * (1 - exports.spread);
  } else if (currencyPair[1] === baseCurrency) {
    return 1 / (rates[currencyPair[0]] * (1 + exports.spread));
  }

  // If neither asset is the base currency, calculate the rate
  let virtualRate = rates[currencyPair[1]] / rates[currencyPair[0]];
  return virtualRate * (1 - exports.spread);

};
