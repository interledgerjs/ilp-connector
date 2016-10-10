'use strict'

const model = require('../models/pairs')

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
  this.body = model.getPairs(this.config, this.tradingPairs)
}
