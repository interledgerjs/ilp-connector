'use strict';

const config = require('../services/config');
const log = require('@ripple/five-bells-shared/services/log')('quote');
const fxRates = require('../services/fxRates');
const NoAmountSpecifiedError = require('../errors/no-amount-specified-error');
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error');
const formatAmount = require('../utils/formatAmount');
const formatAmountCeil = require('../utils/formatAmountCeil');

/* eslint-disable */
/**
 * @api {get} /quote
 *
 * @apiName Quote
 * @apiGroup Quote
 *
 * @apiParam {URI} source_ledger Ledger where the transfer crediting the
 *    trader's account will take place
 * @apiParam {URI} destination_ledger Ledger where the transfer debiting the
 *    trader's account will take place
 * @apiParam {Amount} [source_amount="(Set by trader if destination_amount is
 *    specified)"] Fixed amount to be debited from sender's account
 *    (should not be specified if destination_amount is)
 * @apiParam {Amount} [destination_amount="(Set by trader if source_amount is
 *    specified)"] Fixed amount to be credited to receiver's account
 *    (should not be specified if source_amount is)
 * @apiParam {Number} [destination_expiry_duration="(Maximum allowed if
 *    unspecified)"] Number of milliseconds between when the source transfer is
 *    proposed and when it expires
 * @apiParam {Number} [source_expiry_duration="(Minimum allowed based on
 *    destination_expiry_duration)"] Number of milliseconds between when the
 *    destinatino transfer is proposed and when it expires
 *
 * @apiExample {shell} Fixed Source Amount:
 *    curl https://trader.example? \
 *      source_amount=100.25 \
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

  let rate = yield fxRates.get(this.query.source_ledger,
    this.query.destination_ledger);
  rate = rate.toFixed(5);
  // TODO: fix rounding and make a sensible
  // policy for limiting the smallest units
  log.debug('FX Rate for ' + this.query.source_ledger +
    ' => ' + this.query.destination_ledger + ':', rate);

  let sourceAmount, destinationAmount;
  if (this.query.source_amount) {
    log.debug('creating quote with fixed source amount');
    sourceAmount = formatAmountCeil(this.query.source_amount);
    destinationAmount = formatAmount(this.query.source_amount * rate);
  } else if (this.query.destination_amount) {
    log.debug('creating quote with fixed destination amount');
    sourceAmount = formatAmountCeil(this.query.destination_amount / rate);
    destinationAmount = formatAmount(this.query.destination_amount);
  } else {
    throw new NoAmountSpecifiedError('Must specify either source ' +
      'or destination amount to get quote');
  }

  let destinationExpiryDuration =
    parseFloat(this.query.destination_expiry_duration);
  let sourceExpiryDuration =
    parseFloat(this.query.source_expiry_duration);

  // Check destination_expiry_duration
  if (destinationExpiryDuration) {
    if (destinationExpiryDuration > config.expiry.maxHoldTime) {
      throw new UnacceptableExpiryError('Destination expiry duration ' +
        'is too long');
    }
  } else if (sourceExpiryDuration) {
    destinationExpiryDuration = sourceExpiryDuration
      - config.expiry.minMessageWindow;
  } else {
    destinationExpiryDuration = config.expiry.maxHoldTime;
  }

  // Check difference between destination_expiry_duration
  // and source_expiry_duration
  if (sourceExpiryDuration) {
    if (sourceExpiryDuration - destinationExpiryDuration
        < config.expiry.minMessageWindow) {
      throw new UnacceptableExpiryError('The difference between the ' +
        'destination expiry duration and the source expiry duration ' +
        'is insufficient to ensure that we can execute the ' +
        'source transfers');
    }
  } else {
    sourceExpiryDuration = destinationExpiryDuration +
      config.expiry.minMessageWindow;
  }

  let settlementTemplate = {
    source_transfers: [{
      ledger: this.query.source_ledger,
      credits: [{
        account: config.id,
        amount: sourceAmount
      }],
      expiry_duration: String(sourceExpiryDuration)
    }],
    destination_transfers: [{
      ledger: this.query.destination_ledger,
      debits: [{
        account: config.id,
        amount: destinationAmount
      }],
      expiry_duration: String(destinationExpiryDuration)
    }]
  };

  log.debug('' + sourceAmount + ' ' +
            this.query.source_ledger + ' => ' +
            destinationAmount + ' ' +
            this.query.destination_ledger);

  this.body = settlementTemplate;
};
