'use strict'

const model = require('../models/quote')
const NoAmountSpecifiedError = require('../errors/no-amount-specified-error')
const InvalidUriParameterError = require('five-bells-shared').InvalidUriParameterError
const InvalidAmountSpecifiedError = require('../errors/invalid-amount-specified-error')

/* eslint-disable */
/**
 * @api {get} /quote Get quote
 *
 * @apiName Quote
 * @apiGroup Quote
 *
 * @apiParam {URI} source_address Account where the transfer crediting the
 *    connector's account will take place
 * @apiParam {URI} destination_address Account where the transfer debiting the
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
 * @apiParam {Number} [slippage] Use a slippage other than the connector's default
 *
 * @apiDescription Get a quote from the connector based on either a fixed source
 *    or fixed destination amount.
 *
 * @apiExample {shell} Fixed Source Amount:
 *    curl https://connector.example? \
 *      source_amount=100.25 \
 *      &source_address=eur-ledger.alice \
 *      &destination_address=usd-ledger.bob \
 *      &source_expiry_duration=6 \
 *      &destination_expiry_duration=5 \
 *
 * @apiSuccessExample {json} 200 Quote Response:
 *    HTTP/1.1 200 OK
 *      {
 *        "source_connector_account": "mark",
 *        "source_ledger": "eur-ledger",
 *        "source_amount": "100.25",
 *        "source_expiry_duration": "6000",
 *        "destination_ledger": "usd-ledger",
 *        "destination_amount": "105.71",
 *        "destination_expiry_duration": "5000"
 *      }
 *
 * @apiExample {shell} Fixed Destination Amount:
 *    curl https://connector.example? \
 *      destination_amount=105.71 \
 *      &source_address=eur-ledger.alice \
 *      &destination_address=usd-ledger.bob \
 *      &source_expiry_duration=6000 \
 *      &destination_expiry_duration=5000 \
 *
 * @apiSuccessExample {json} 200 Quote Response:
 *    HTTP/1.1 200 OK
 *      {
 *        "source_connector_account": "mark",
 *        "source_ledger": "eur-ledger",
 *        "source_amount": "100.25",
 *        "source_expiry_duration": "6000",
 *        "destination_ledger": "usd-ledger",
 *        "destination_amount": "105.71",
 *        "destination_expiry_duration": "5000"
 *      }
 *
 * @apiUse UnacceptableExpiryError
 * @apiUse AssetsNotTradedError
 */
/* eslint-enable */

exports.get = function * () {
  validateAmounts(this.query.source_amount, this.query.destination_amount)
  validatePrecisionAndScale(this.query.destination_precision, this.query.destination_scale)
  if (!this.query.source_address) {
    throw new InvalidUriParameterError('Missing required parameter: source_address')
  }
  if (!this.query.destination_address) {
    throw new InvalidUriParameterError('Missing required parameter: destination_address')
  }
  this.body = yield model.getQuote(this.query, this.config, this.routeBuilder, this.balanceCache)
}

function validateAmounts (sourceAmount, destinationAmount) {
  if (sourceAmount && destinationAmount) {
    throw new InvalidUriParameterError('Exactly one of source_amount or destination_amount must be specified')
  }
  if (!sourceAmount && !destinationAmount) {
    throw new NoAmountSpecifiedError('Exactly one of source_amount or destination_amount must be specified')
  }
  if (sourceAmount) {
    if (isNaN(sourceAmount) || Number(sourceAmount) <= 0 ||
      Number(sourceAmount) === Number.POSITIVE_INFINITY) {
      throw new InvalidAmountSpecifiedError('source_amount must be finite and positive')
    }
  } else if (destinationAmount) {
    if (isNaN(destinationAmount) || Number(destinationAmount) <= 0 ||
      Number(destinationAmount) === Number.POSITIVE_INFINITY) {
      throw new InvalidAmountSpecifiedError('destination_amount must be finite and positive')
    }
  }
}

function validatePrecisionAndScale (precision, scale) {
  if (precision && scale) return
  if (!precision && !scale) return
  throw new InvalidUriParameterError('Either both or neither of "precision" and "scale" must be specified')
}
