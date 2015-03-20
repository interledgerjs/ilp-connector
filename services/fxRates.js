'use strict';
const request = require('co-request');
const NotFoundError = require('five-bells-shared/errors/not-found-error');

// If the fxRatesApi is changed, make sure to change the tests
// because another feed will likely have a different data format
exports.fxRatesApi = 'http://api.fixer.io/latest';
exports.spread = 0.002;

// TODO: actually limit the rates returned to the ledgers we have assets on
exports.get = function *get(source_asset, destination_asset) {
  let result = yield request({
    uri: exports.fxRatesApi,
    json: true
  });
  let body = result.body;
  let rates = body.rates;
  let baseCurrency = body.base;

  // If one of the chosen assets if the base, the rate is already included
  if (source_asset === baseCurrency) {
    return rates[destination_asset] * (1 - exports.spread);
  } else if (destination_asset === baseCurrency) {
    return 1 / (rates[source_asset] * (1 + exports.spread));
  }

  // Throw an error if the currency pair is not supported
  if (!rates.hasOwnProperty(source_asset) ||
    !rates.hasOwnProperty(destination_asset)) {
    throw new NotFoundError('No quote available for the given currency pair');
  }

  // If neither asset is the base currency, calculate the rate
  let virtualRate = rates[destination_asset] / rates[source_asset];
  return virtualRate * (1 - exports.spread);

};
