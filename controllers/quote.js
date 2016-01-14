'use strict'

const request = require('co-request')
const config = require('../services/config')
const log = require('../services/log')('quote')
const backend = require('../services/backend')
const ledgers = require('../services/ledgers')
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')

/* eslint-disable */
/**
 * @api {get} /quote
 *
 * @apiName Quote
 * @apiGroup Quote
 *
 * @apiParam {URI} source_ledger Ledger where the transfer crediting the
 *    connector's account will take place
 * @apiParam {URI} destination_ledger Ledger where the transfer debiting the
 *    connector's account will take place
 * @apiParam {Number} [source_amount="(Set by connector if destination_amount is
 *    specified)"] Fixed amount to be debited from sender's account
 *    (should not be specified if destination_amount is)
 * @apiParam {Number} [destination_amount="(Set by connector if source_amount is
 *    specified)"] Fixed amount to be credited to receiver's account
 *    (should not be specified if source_amount is)
 * @apiParam {Number} [destination_expiry_duration="(Maximum allowed if
 *    unspecified)"] Number of milliseconds between when the source transfer is
 *    proposed and when it expires
 * @apiParam {Number} [source_expiry_duration="(Minimum allowed based on
 *    destination_expiry_duration)"] Number of milliseconds between when the
 *    destination transfer is proposed and when it expires
 *
 * @apiExample {shell} Fixed Source Amount:
 *    curl https://connector.example? \
 *      source_amount=100.25 \
 *      &source_ledger=https://eur-ledger.example/EUR \
 *      &destination_ledger=https://usd-ledger.example/USD \
 *      &source_expiry_duration=6 \
 *      &destination_expiry_duration=5 \
 *
 * @apiSuccessExample {json} 200 Quote Response:
 *    HTTP/1.1 200 OK
 *      {
 *        "source_transfers": [
 *          {
 *            "ledger": "http://eur-ledger.example/EUR",
 *            "credits": [
 *              {
 *                "account": "mark",
 *                "amount": "100.25"
 *              }
 *            ],
 *            "expiry_duration": "6000"
 *          }
 *        ],
 *        "destination_transfers": [
 *          {
 *            "ledger": "http://usd-ledger.example/USD",
 *            "debits": [
 *              {
 *                "amount": "105.71",
 *                "account": "mark"
 *              }
 *            ],
 *            "expiry_duration": "5000"
 *          }
 *        ]
 *      }
 *
 * @apiExample {shell} Fixed Destination Amount:
 *    curl https://connector.example? \
 *      destination_amount=105.71 \
 *      &source_ledger=https://eur-ledger.example/EUR \
 *      &destination_ledger=https://usd-ledger.example/USD \
 *      &source_expiry_duration=6000 \
 *      &destination_expiry_duration=5000 \
 *
 * @apiSuccessExample {json} 200 Quote Response:
 *    HTTP/1.1 200 OK
 *      {
 *        "source_transfers": [
 *          {
 *            "ledger": "http://eur-ledger.example/EUR",
 *            "credits": [
 *              {
 *                "account": "mark",
 *                "amount": "100.25"
 *              }
 *            ],
 *            "expiry_duration": "6000"
 *          }
 *        ],
 *        "destination_transfers": [
 *          {
 *            "ledger": "http://usd-ledger.example/USD",
 *            "debits": [
 *              {
 *                "amount": "105.71",
 *                "account": "mark"
 *              }
 *            ],
 *            "expiry_duration": "5000"
 *          }
 *        ]
 *      }
 *
 * @apiErrorExample {json} 400 No Amount Specified:
 *    HTTP/1.1 400 Bad Request
 *      {
 *        "id": "NoAmountSpecifiedError",
 *        "message": "Must specify either source or destination amount to get quote"
 *      }
 *
 * @apiErrorExample {json} 422 Message Window Too Short:
 *    HTTP/1.1 422 Bad Request
 *      {
 *        "id": "UnacceptableExpiryError",
 *        "message": "The difference between the destination expiry duration and the source expiry duration is insufficient to ensure that we can execute the source transfers"
 *      }
 */
/* eslint-enable */

exports.get = function *() {
  const query = new QuoteQuery(this.query)
  yield query.loadLedgers()
  const quote = yield backend.getQuote(query.toQuoteArgs())

  log.debug('' +
    quote.source_amount.toFixed(2) + ' ' +
    query.source_ledger + ' => ' +
    quote.destination_amount.toFixed(2) + ' ' +
    query.destination_ledger)

  this.body = query.toPaymentTemplate(quote)
}

function QuoteQuery (params) {
  // TODO: include the expiry duration in the quote logic
  let destinationExpiryDuration = parseFloat(params.destination_expiry_duration)
  let sourceExpiryDuration = parseFloat(params.source_expiry_duration)

  // Check destination_expiry_duration
  if (destinationExpiryDuration) {
    if (destinationExpiryDuration > config.expiry.maxHoldTime) {
      throw new UnacceptableExpiryError('Destination expiry duration ' +
        'is too long, destinationExpiryDuration: ' + destinationExpiryDuration +
        ', maxHoldTime: ' + config.expiry.maxHoldTime)
    }
  } else if (sourceExpiryDuration) {
    destinationExpiryDuration = sourceExpiryDuration - config.expiry.minMessageWindow
  } else {
    destinationExpiryDuration = config.expiry.maxHoldTime
  }

  // Check difference between destination_expiry_duration
  // and source_expiry_duration
  if (sourceExpiryDuration) {
    if (sourceExpiryDuration - destinationExpiryDuration <
      config.expiry.minMessageWindow) {
      throw new UnacceptableExpiryError('The difference between the ' +
        'destination expiry duration and the source expiry duration ' +
        'is insufficient to ensure that we can execute the ' +
        'source transfers')
    }
  } else {
    sourceExpiryDuration = destinationExpiryDuration + config.expiry.minMessageWindow
  }

  this.destinationExpiryDuration = destinationExpiryDuration
  this.sourceExpiryDuration = sourceExpiryDuration
  this.source_amount = params.source_amount
  this.destination_amount = params.destination_amount

  this.source_ledger = params.source_ledger
  this.destination_ledger = params.destination_ledger
  this.source_account = params.source_account || null
  this.destination_account = params.destination_account || null
}

QuoteQuery.prototype.loadLedgers = function * () {
  if (this.source_ledger || this.source_account) {
    this.source_ledger = this.source_ledger || (yield getAccountLedger(this.source_account))
  } else {
    throw new Error('Missing required parameter: source_ledger or source_account')
  }
  if (this.destination_ledger || this.destination_account) {
    this.destination_ledger = this.destination_ledger || (yield getAccountLedger(this.destination_account))
  } else {
    throw new Error('Missing required parameter: destination_ledger or destination_account')
  }
}

QuoteQuery.prototype.toQuoteArgs = function () {
  return {
    source_ledger: this.source_ledger,
    destination_ledger: this.destination_ledger,
    source_amount: this.source_amount,
    destination_amount: this.destination_amount
  }
}

QuoteQuery.prototype.toPaymentTemplate = function (quote) {
  const source_amount = quote.source_amount.toFixed(2, 2)
  const destination_amount = quote.destination_amount.toFixed(2)
  const payment = {
    source_transfers: [{
      type: ledgers.getType(this.source_ledger),
      ledger: this.source_ledger,
      debits: [{
        account: this.source_account,
        amount: source_amount
      }],
      credits: [
        ledgers.makeFundTemplate(this.source_ledger, {amount: source_amount})
      ],
      expiry_duration: String(this.sourceExpiryDuration)
    }],
    destination_transfers: [{
      type: ledgers.getType(this.destination_ledger),
      ledger: this.destination_ledger,
      debits: [
        ledgers.makeFundTemplate(this.destination_ledger, {amount: destination_amount})
      ],
      credits: [{
        account: this.destination_account,
        amount: destination_amount
      }],
      expiry_duration: String(this.destinationExpiryDuration)
    }]
  }
  return payment
}

function * getAccountLedger (account) {
  const res = yield request({
    method: 'get',
    uri: account,
    json: true
  })
  const ledger = res.body && res.body.ledger
  if (res.statusCode !== 200 || !ledger) {
    throw new Error('Unable to identify ledger from account: ' + account)
  }
  return ledger
}
