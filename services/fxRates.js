'use strict';
const _ = require('lodash');
const request = require('co-request');
const config = require('./config');
const AssetsNotTradedError = require('../errors/assets-not-traded-error');

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

let latestRates;
let latestRatesDate;
function *getRates() {
  // If there are no rates, or they have expired, update them
  if (!latestRates ||
      (latestRatesDate + config.fx.ratesCacheTtl) < Number(new Date())) {
    let result = yield request({
      uri: config.fx.ratesApi,
      json: true
    });
    latestRates = result.body;
  }
  return latestRates;
}

// TODO: actually limit the rates returned to the ledgers we have assets on
exports.get = function *get(source_ledger, destination_ledger) {
  let body = yield getRates();
  let rates = body.rates;
  let baseCurrency = body.base;
  // The base currency trades 1:1 to itself
  rates[baseCurrency] = 1;

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

  // Get ratio between currencies and apply spread
  return rates[currencyPair[1]] / rates[currencyPair[0]];
};

exports.subtractSpread = function(amount) {
  return amount * (1 - config.fx.spread);
};

exports.addSpread = function(amount) {
  return amount * (1 + config.fx.spread);
};
