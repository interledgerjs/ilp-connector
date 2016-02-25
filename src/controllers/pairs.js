'use strict'

const config = require('../services/config')

/* eslint-disable */
/**
 * @api {get} /pairs Get currency pairs
 *
 * @apiName GetPairs
 * @apiGroup Currency Pairs
 *
 * @apiDescription Get the currency pairs for which this connector can provide quotes
 *    and facilitate payments.
 *
 * @apiSuccessExample {json} Get Currency Pairs
 *   HTTP/1.1 200 OK
 *     [
 *       {
 *         "source_asset": "USD",
 *         "source_ledger": "https://usd-ledger.example/USD",
 *         "destination_asset": "EUR",
 *         "destination_ledger": "https://eur-ledger.example/EUR"
 *       },
 *       {
 *         "source_asset": "EUR",
 *         "source_ledger": "https://eur-ledger.example/EUR",
 *         "destination_asset": "USD",
 *         "destination_ledger": "https://usd-ledger.example/USD"
 *       },
 *       {
 *         "source_asset": "JPY",
 *         "source_ledger": "https://jpy-ledger.example/JPY",
 *         "destination_asset": "USD",
 *         "destination_ledger": "https://usd-ledger.example/USD"
 *       }]
 */
/* eslint-enable */
exports.getCollection = function * getCollection () {
  let pairs = config.get('tradingPairs').toJS().map(function (pair) {
    let currencies = pair.map(function (s) {
      return s.split('@')
    })
    return {
      source_asset: currencies[0][0],
      source_ledger: currencies[0][1],
      destination_asset: currencies[1][0],
      destination_ledger: currencies[1][1]
    }
  })
  this.body = pairs
}
