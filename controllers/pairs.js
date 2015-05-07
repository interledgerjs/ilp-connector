'use strict';

const config = require('../services/config');

exports.getCollection = function *getCollection() {
  let pairs = config.tradingPairs.map(function (pair) {
    let currencies = pair.map(function (s) {
      return s.split('@');
    });
    return {
      source_asset: currencies[0][0],
      source_ledger: currencies[0][1],
      destination_asset: currencies[1][0],
      destination_ledger: currencies[1][1]
    };
  });
  this.body = pairs;
};
