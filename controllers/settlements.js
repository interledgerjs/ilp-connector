'use strict';

const _ = require('lodash');
const moment = require('moment');
const request = require('co-request');
const requestUtil = require('@ripple/five-bells-shared/utils/request');
const log = require('@ripple/five-bells-shared/services/log')('settlements');
const executeSourceTransfers = require('../lib/executeSourceTransfers');
const config = require('../services/config');
const fxRates = require('../services/fxRates');
const subscriptionRecords = require('../services/subscriptionRecords');
const ExternalError = require('../errors/external-error');
const UnacceptableConditionsError =
  require('../errors/unacceptable-conditions-error');
const UnacceptableRateError = require('../errors/unacceptable-rate-error');
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error');
const InsufficientFeeError =
  require('../errors/insufficient-fee-error');
const NoRelatedSourceCreditError =
  require('../errors/no-related-source-credit-error');
const NoRelatedDestinationDebitError =
  require('../errors/no-related-destination-debit-error');
const FundsNotHeldError = require('../errors/funds-not-held-error');
const ManyToManyNotSupportedError =
  require('../errors/many-to-many-not-supported-error');
const hashJSON = require('@ripple/five-bells-shared/utils/hashJson');

function sourceConditionIsDestinationTransfer(source, destination) {
  // Check the message or message_hash
  let expectedMessage = {
    id: destination.id,
    state: 'executed'
  };

  if (source.execution_condition.message &&
      !_.isEqual(source.execution_condition.message, expectedMessage)) {
    log.debug('condition does not match the execution of the destination ' +
      'transfer, unexpected message');
    return false;
  }
  if (source.execution_condition.message_hash &&
      source.execution_condition.message_hash !== hashJSON(expectedMessage)) {
    log.debug('condition does not match the execution of the destination ' +
      'transfer, unexpected message hash');
    return false;
  }

  // Check the signer
  if (source.execution_condition.signer &&
      source.execution_condition.signer !== destination.ledger) {
    log.debug('condition does not match the execution of the destination ' +
      'transfer, unexpected signer');
    return false;
  }

  // TODO: once we have the ledger public keys cached locally
  // validate that the public_key is the one we expect

  return true;
}

function sourceConditionSameAsAllDestinationConditions(
  sourceTransfer, destination_transfers) {
  return _.every(destination_transfers,
    function(destinationTransfer) {
      return _.isEqual(sourceTransfer.execution_condition,
        destinationTransfer.execution_condition);
    });
}

function validateExecutionConditions (settlement) {

  log.debug('validating execution conditions');
  // We need to have confidence that the source transfers will actually happen.
  // So each one has to depend on something we control, namely the destination
  // transfer or the condition of all of the destination transfers.
  // (So we can just copy the condition's fulfillment.)

  // Note that implementing this correctly is VERY IMPORTANT for the trader
  // to make sure they get paid back and avoid getting screwed

  // If this logic changes, make sure to change the logic in
  // validateExpiry as well

  let valid = _.every(settlement.source_transfers, function(sourceTransfer) {

    let conditionIsDestTransfer =
      settlement.destination_transfers.length === 1 &&
      sourceConditionIsDestinationTransfer(sourceTransfer,
        settlement.destination_transfers[0]);

    let conditionsAreEqual =
      sourceConditionSameAsAllDestinationConditions(
        sourceTransfer, settlement.destination_transfers);

    return conditionIsDestTransfer || conditionsAreEqual;
  });

  if (!valid) {
    throw new UnacceptableConditionsError('Each of the source transfers\' ' +
      'execution conditions must either match all of the destination ' +
      'transfers\' conditions or if there is only one destination transfer ' +
      'the source transfers\' conditions can be the execution of the ' +
      'destination transfer');
  }
}

function *validateExecutionConditionPublicKey (settlement) {
  // TODO: use a cache of ledgers' public keys and move this functionality
  // into the synchronous validateExecutionConditions function
  for (let sourceTransfer of settlement.source_transfers) {

    let conditionsAreEqual =
      sourceConditionSameAsAllDestinationConditions(
        sourceTransfer, settlement.destination_transfers);

    if (!conditionsAreEqual) {
      // Check the public_key and algorithm
      // TODO: what do we do if the transfer hasn't been submitted
      // to the destination ledger yet?
      let destinationTransferStateReq = yield request({
        method: 'get',
        uri: settlement.destination_transfers[0].id + '/state',
        json: true
      });

      // TODO: add retry logic
      // TODO: what if the response is malformed or missing fields?
      if (destinationTransferStateReq.statusCode >= 400) {
        log.error('remote error while checking destination transfer state');
        throw new ExternalError('Received an unexpected ' +
          destinationTransferStateReq.body.id +
          ' while checking destination transfer state ' +
          settlement.destination_transfers[0].id);
      }

      if (sourceTransfer.execution_condition.algorithm !==
            destinationTransferStateReq.body.algorithm) {
        throw new UnacceptableConditionsError('Source transfer execution ' +
          'condition algorithm must match the destination ledger\'s.');
      }
      if (sourceTransfer.execution_condition.public_key !==
            destinationTransferStateReq.body.public_key) {
        throw new UnacceptableConditionsError('Source transfer execution ' +
          'condition public key must match the destination ledger\'s.');
      }
    }
  }
}

function validateSouceTransferIsPrepared(transfer) {
  if (transfer.state !== 'prepared' &&
      transfer.state !== 'executed') {
    throw new FundsNotHeldError('Source transfer must be in the prepared ' +
      'state for the trader to authorize the destination transfer');
  }
}

function validateSourceTransfersArePrepared (settlement) {
  log.debug('validating source transfer is prepared');
  _.forEach(settlement.source_transfers, validateSouceTransferIsPrepared);
}

function validateExpiry (settlement) {
  // TODO use a more intelligent value for the minMessageWindow
  // TODO tie the maxHoldTime to the fx rate
  // TODO bring all these loops into one to speed this up

  // Verify none of the transfers has already expired
  function validateNotExpired (transfer) {
    if (transfer.expires_at &&
        transfer.state !== 'executed' &&
        moment(transfer.expires_at, moment.ISO_8601).isBefore(moment())) {

      throw new UnacceptableExpiryError('Transfer has already expired');
    }
  }
  _.forEach(settlement.source_transfers, validateNotExpired);
  _.forEach(settlement.destination_transfers, validateNotExpired);

  // Check the transfers against the minMessageWindow and maxHoldTime
  let destinationHasExecutionCondition =
    _.some(settlement.destination_transfers, function(transfer) {
      return transfer.hasOwnProperty('execution_condition');
  });
  if (destinationHasExecutionCondition) {
    // If the destination transfer(s) have execution condition(s)
    // we need to make sure we're not being asked
    // to hold money for too long
    _.forEach(settlement.destination_transfers, function(transfer) {
      if (!transfer.expires_at) {
        throw new UnacceptableExpiryError('Destination transfers with ' +
          'execution conditions must have an expires_at field for trader ' +
          'to agree to authorize them');
      }
      if (moment(transfer.expires_at, moment.ISO_8601).diff(moment())
          > config.expiry.maxHoldTime * 1000) {
        throw new UnacceptableExpiryError('Destination transfer expiry is ' +
          'too far in the future. The trader\'s money would need to be ' +
          'held for too long');
      }
    });

    // We also need to check if we have enough time between the expiry
    // of the destination transfer with the latest expiry and the expiry of
    // the source transfer with the earliest expiry is greater than the
    // minMessageWindow.
    // This is done to ensure that we have enough time after the last
    // moment one of the destination transfers could happen (taking money out
    // of our account) to execute all of the source transfers
    let earliestSourceTransferExpiry =
      _.min(_.map(settlement.source_transfers, function(transfer) {
      return (transfer.expires_at && transfer.state !== 'executed' ?
          moment(transfer.expires_at, moment.ISO_8601).valueOf() :
          Math.max());
      }));

    let latestDestinationTransferExpiry =
      _.max(_.map(settlement.destination_transfers, function(transfer) {
        return moment(transfer.expires_at, moment.ISO_8601).valueOf();
      }));
    if (earliestSourceTransferExpiry - latestDestinationTransferExpiry
        < config.expiry.minMessageWindow * 1000) {

      throw new UnacceptableExpiryError('The window between the latest ' +
        'destination transfer expiry and the earliest source transfer expiry ' +
        'is insufficient to ensure that we can execute the source transfers');
    }

  } else {
    // If we are the last trader we're not going to put money on hold
    // so we don't care about the maxHoldTime
    // We only care that we have enough time to execute the destination
    // transfer(s) before the source transfers expire

    // Check that we have enough time to execute the destination transfer
    // TODO use a better value for the minExecutionWindow
    let minExecutionWindow = config.expiry.minMessageWindow * 1000;
    _.forEach(settlement.destination_transfers, function(transfer) {
      if (transfer.expires_at &&
          moment(transfer.expires_at, moment.ISO_8601).diff(moment())
            < minExecutionWindow) {
        throw new UnacceptableExpiryError('There is insufficient time for ' +
          'the trader to execute the destination transfer before it expires');
      }
    });

    // Check that we can execute the destination transfer and
    // have enough time to execute the source transfers before
    // they expire
    _.forEach(settlement.source_transfers, function(transfer) {
      if (transfer.expires_at &&
          transfer.state !== 'executed' &&
          moment(transfer.expires_at, moment.ISO_8601).diff(moment())
            < minExecutionWindow + config.expiry.minMessageWindow * 1000) {
        throw new UnacceptableExpiryError('There is insufficient time for ' +
          'the trader to execute the destination transfer before the source ' +
          'transfer(s) expire(s)');
      }
    });
  }
}

function amountFinder (creditOrDebit) {
  // TODO: change this check when the account ids become IRIs
  return (creditOrDebit.account === config.id ?
    parseFloat(creditOrDebit.amount) :
    0);
}

/**
 * Function to sum the credits or debits from the given array of
 * transfers and convert the amount into a single asset for
 * easier comparisons.
 *
 * @param {Array of Transfers} opts.transfers Either the source or destination transfers
 * @param {String} opts.transferSide Either 'source' or 'destination'
 * @param {String} opts.creditsOrDebits Indicates whether we want to sum the relevant credits or debits in the given transfers
 * @param {Boolean} opts.noErrors If true, don't throw errors for NoRelatedSourceCredit or DestinationDebit
 * @param {String} opts.convertToLedger The ledger representing the asset we will convert all of the amounts into (for easier comparisons)
 * @yield {Float} The total amount converted into the asset represented by opts.convertToLedger
 */
function *calculateAmountEquivalent(opts) {

  // convertedAmountTotal is going to be the total of either the credits
  // if the transfers are source_transfers or debits if the transfers
  // are destination_transfers (the amount that is either entering
  // or leaving our account)
  // Then, we are going to use the fxRates to convert the amount
  // into the asset represented by convertToLedger
  let convertedAmountTotal = 0;

  if (!opts.transfers || opts.transfers.length === 0) {
    return convertedAmountTotal;
  }

  for (let transfer of opts.transfers) {

    // Total the number of credits or debits to the traders account
    let relevantAmountTotal =
      _.sum(transfer[opts.creditsOrDebits], amountFinder);

    // Throw an error if we're not included in the transfer
    if (relevantAmountTotal <= 0 && !opts.noErrors) {
      if (opts.transferSide === 'source') {
        throw new NoRelatedSourceCreditError('Trader\'s account ' +
          'must be credited in all source transfers to ' +
          'provide settlement');
      } else if (opts.transferSide === 'destination') {
        throw new NoRelatedDestinationDebitError('Trader\'s account ' +
          'must be debited in all destination transfers to ' +
          'provide settlement');
      }
    }

    // Calculate how much the relevantAmountTotal is worth in
    // the asset represented by convertToLedger
    let rate;
    if (transfer.ledger === opts.convertToLedger) {
      convertedAmountTotal += relevantAmountTotal;
    } else if (opts.transferSide === 'source') {
      rate = yield fxRates.get(transfer.ledger, opts.convertToLedger);
      convertedAmountTotal += relevantAmountTotal * rate;
    } else if (opts.transferSide === 'destination') {
      rate = yield fxRates.get(opts.convertToLedger, transfer.ledger);
      convertedAmountTotal += relevantAmountTotal / rate;
    }
  }
  return convertedAmountTotal;
}

function *validateRate (settlement) {

  log.debug('validating rate');

  // Determine which ledger's asset we will convert all
  // of the others to
  let convertToLedger;
  if (settlement.source_transfers.length === 1) {
    convertToLedger = settlement.source_transfers[0].ledger;
  } else {
    convertToLedger = settlement.destination_transfers[0].ledger;
  }

  // Convert the source credits and destination debits to a
  // common asset so we can more easily compare them
  const sourceCreditEquivalent =
    yield calculateAmountEquivalent({
      transfers: settlement.source_transfers,
      transferSide: 'source',
      creditsOrDebits: 'credits',
      convertToLedger: convertToLedger
    });
  const destinationDebitEquivalent =
    yield calculateAmountEquivalent({
      transfers: settlement.destination_transfers,
      transferSide: 'destination',
      creditsOrDebits: 'debits',
      convertToLedger: convertToLedger
    });

  if (fxRates.subtractSpread(sourceCreditEquivalent)
      < destinationDebitEquivalent) {
    throw new UnacceptableRateError('Settlement rate does not match ' +
      'the rate currently offered');
  }
}

function *validateFee (settlement) {
  // Determine which ledger's asset we will convert all
  // of the others to
  let convertToLedger;
  if (settlement.source_transfers.length === 1) {
    convertToLedger = settlement.source_transfers[0].ledger;
  } else {
    convertToLedger = settlement.destination_transfers[0].ledger;
  }

  // TODO: make sure the source_fee_transfers have been executed
  const sourceFeesEquivalent =
    yield calculateAmountEquivalent({
      transfers: settlement.source_fee_transfers,
      transferSide: 'source',
      creditsOrDebits: 'credits',
      convertToLedger: convertToLedger,
      noErrors: true
    });

  if (sourceFeesEquivalent === 0) {
    throw new InsufficientFeeError('Source fee transfer ' +
      'must be paid to account for cost of holding funds');
  }

  // Calculate cost of held funds
  const destinationDebitEquivalent =
    yield calculateAmountEquivalent({
      transfers: settlement.destination_transfers,
      transferSide: 'destination',
      creditsOrDebits: 'debits',
      convertToLedger: convertToLedger,
      noErrors: true
    });
  const costOfHeldFunds = config.expiry.feePercentage / 100 *
      destinationDebitEquivalent;

  // Calculate how much we're supposed to pay out in fees
  const destinationFeesEquivalent =
    yield calculateAmountEquivalent({
      transfers: settlement.destination_fee_transfers,
      transferSide: 'destination',
      creditsOrDebits: 'debits',
      convertToLedger: convertToLedger,
      noErrors: true
    });

  const totalCost = costOfHeldFunds + destinationFeesEquivalent;

  if (sourceFeesEquivalent < totalCost) {
    throw new InsufficientFeeError('Source fees are ' +
      'insufficient to cover the cost of holding funds ' +
      'and paying the fees for the destination transfers');
  }
}

function validateOneToManyOrManyToOne (settlement) {
  if (settlement.source_transfers.length > 1 &&
      settlement.destination_transfers.length > 1) {
    throw new ManyToManyNotSupportedError('This trader does not support ' +
      'settlements that include multiple source transfers and multiple ' +
      'destination transfers');
  }
}

// Note this modifies the original object
function addAuthorizationToTransfers (transfers) {
  // TODO: make sure we're not authorizing anything extra
  // that shouldn't be taking money out of our account
  for (let transfer of transfers) {
    for (let debit of transfer.debits) {

      // TODO change this when the trader's account
      // isn't the same on all ledgers
      if (debit.account === config.id) {
        debit.authorized = true;
      }
    }
  }

  // TODO authorize credits
}

function *submitTransfers (transfers, correspondingSourceTransfers) {
  for (let transfer of transfers) {
    // TODO: check before this point that we actually have
    // credentials for the ledgers we're asked to settle between
    let credentials = config.ledgerCredentials[transfer.ledger];
    let transferReq = yield request({
      method: 'put',
      auth: {
        user: credentials.username,
        pass: credentials.password
      },
      uri: transfer.id,
      body: transfer,
      json: true
    });

    if (transferReq.statusCode >= 400) {
      log.error('remote error while authorizing destination transfer');
      log.debug(transferReq.body);
      throw new ExternalError('Received an unexpected ' +
        transferReq.body.id +
        ' while processing destination transfer.');
    }

    // Update destination_transfer state from the ledger's response
    transfer.state = transferReq.body.state;

    if (transferReq.body.state === 'executed') {
      transfer.execution_condition_fulfillment =
        transferReq.body.execution_condition_fulfillment;
    } else if (correspondingSourceTransfers) {
      // Store this subscription so when we get the notification
      // we know what source transfer to go and unlock
      log.debug('destination transfer not yet executed, ' +
        'added subscription record');
      subscriptionRecords.put(transfer.id,
        correspondingSourceTransfers);
    }
  }
}

/* eslint-disable */
/**
 * @api {put} /settlements/:id
 *
 * @apiName CreateSettlement
 * @apiGroup Settlements
 *
 * @apiParam {UUID} id Settlement UUID
 * @apiParam {Transfer[]} source_transfers Array of source transfers that credit the trader
 * @apiParam {Transfer[]} destination_transfers Array of destination transfers that debit the trader
 *
 * @apiExample {shell} One-to-one Settlement:
 *    curl -x PUT -H "Content-Type: application/json" -d
 *      '{
 *        "id": "c9377529-d7df-4aa1-ae37-ad5148612003",
 *        "source_transfers":[{
 *          "id": "http://usd-ledger.example/USD/transfers/6851929f-5a91-4d02-b9f4-4ae6b7f1768c",
 *          "ledger":"http://usd-ledger.example/USD",
 *          "debits":[{
 *            "amount":"1.07",
 *            "account":"alice"
 *          }],
 *          "credits":[{
 *            "amount":"1.07",
 *            "account":"mark"
 *          }],
 *          "execution_condition": {
 *            "message": {
 *              "id": "http://otherledger.example/transfers/e80b0afb-f3dc-49d7-885c-fc802ddf4cc1",
 *              "state": "executed"
 *            },
 *            "signer": "http://otherledger.example",
 *            "algorithm": "ed25519-sha512",
 *            "public_key": "Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg="
 *          },
 *          "expires_at": "2015-06-16T00:00:11.000Z",
 *          "state": "prepared"
 *        }],
 *        "destination_transfers":[{
 *          "id": "http://eur-ledger.example/EUR/transfers/c92f2a2c-b21d-4e6c-96e7-4f6d6df4bee9",
 *          "ledger":"http://eur-ledger.example/EUR",
 *          "debits":[{
 *            "amount":"1.00",
 *            "account":"mark"
 *          }],
 *          "credits":[{
 *            "amount":"1.00",
 *            "account":"bob"
 *          }],
 *          "execution_condition": {
 *            "message": {
 *              "id": "http://otherledger.example/transfers/e80b0afb-f3dc-49d7-885c-fc802ddf4cc1",
 *              "state": "executed"
 *            },
 *            "signer": "http://otherledger.example",
 *            "algorithm": "ed25519-sha512",
 *            "public_key": "Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg="
 *          },
 *          "expires_at": "2015-06-16T00:00:10.000Z",
 *          "state": "proposed"
 *        }]
 *      }'
 *    https://trader.example/settlements/c9377529-d7df-4aa1-ae37-ad5148612003
 *
 * @apiSuccessExample {json} 201 New Settlement Response:
 *    HTTP/1.1 201 CREATED
 *      {
 *        "id": "c9377529-d7df-4aa1-ae37-ad5148612003",
 *        "source_transfers":[{
 *          "id": "http://usd-ledger.example/USD/transfers/6851929f-5a91-4d02-b9f4-4ae6b7f1768c",
 *          "ledger":"http://usd-ledger.example/USD",
 *          "debits":[{
 *            "amount":"1.07",
 *            "account":"alice"
 *          }],
 *          "credits":[{
 *            "amount":"1.07",
 *            "account":"mark"
 *          }],
 *          "execution_condition": {
 *            "message": {
 *              "id": "http://otherledger.example/transfers/e80b0afb-f3dc-49d7-885c-fc802ddf4cc1",
 *              "state": "executed"
 *            },
 *            "signer": "http://otherledger.example",
 *            "algorithm": "ed25519-sha512",
 *            "public_key": "Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg="
 *          },
 *          "execution_condition_fulfillment": {
 *            "signature": "ZF6EYl0NgaHg5gVCwvUBMrbh6UL+ytPFhAAxV/j5kYpWsBZtaeo/KPSJRKMhfcTrESVlPwT98iMxpWWrJRdrDw=="
 *          },
 *          "expires_at": "2015-06-16T00:00:11.000Z",
 *          "state": "executed"
 *        }],
 *        "destination_transfers":[{
 *          "id": "http://eur-ledger.example/EUR/transfers/c92f2a2c-b21d-4e6c-96e7-4f6d6df4bee9",
 *          "ledger":"http://eur-ledger.example/EUR",
 *          "debits":[{
 *            "amount":"1.00",
 *            "account":"mark"
 *          }],
 *          "credits":[{
 *            "amount":"1.00",
 *            "account":"bob"
 *          }],
 *          "execution_condition": {
 *            "message": {
 *              "id": "http://otherledger.example/transfers/e80b0afb-f3dc-49d7-885c-fc802ddf4cc1",
 *              "state": "executed"
 *            },
 *            "signer": "http://otherledger.example",
 *            "algorithm": "ed25519-sha512",
 *            "public_key": "Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg="
 *          },
 *          "execution_condition_fulfillment": {
 *            "signature": "ZF6EYl0NgaHg5gVCwvUBMrbh6UL+ytPFhAAxV/j5kYpWsBZtaeo/KPSJRKMhfcTrESVlPwT98iMxpWWrJRdrDw=="
 *          },
 *          "expires_at": "2015-06-16T00:00:10.000Z",
 *          "state": "executed"
 *        }]
 *      }
 *
 * @apiErrorExample {json} 400 Invalid Settlement
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "id": "InvalidBodyError",
 *       "message": "JSON request body is not a valid Settlement",
 *       "validationErrors": [
 *         {
 *           "message": "Missing required property \"debits\"",
 *           "context": "#/source_transfers/0",
 *           "value": {
 *             "id": "http://usd-ledger.example/USD/transfers/6851929f-5a91-4d02-b9f4-4ae6b7f1768c",
 *             "ledger": "http://usd-ledger.example/USD",
 *             "credits": [
 *               {
 *                 "amount": "1.07",
 *                 "account": "mark"
 *               }
 *             ],
 *             "execution_condition": {
 *               "message": {
 *                 "id": "http://eur-ledger.example/EUR/transfers/c92f2a2c-b21d-4e6c-96e7-4f6d6df4bee9",
 *                 "state": "executed"
 *               },
 *               "algorithm": "ed25519-sha512",
 *               "public_key": "Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg="
 *             },
 *             "expires_at": "2015-06-16T00:00:02.000Z",
 *             "state": "prepared"
 *           },
 *           "criteria": "debits"
 *         },
 *         {
 *           "message": "Failed \"items\" criteria",
 *           "context": "#/source_transfers/0",
 *           "value": [
 *             {
 *               "id": "http://usd-ledger.example/USD/transfers/6851929f-5a91-4d02-b9f4-4ae6b7f1768c",
 *               "ledger": "http://usd-ledger.example/USD",
 *               "credits": [
 *                 {
 *                   "amount": "1.07",
 *                   "account": "mark"
 *                 }
 *               ],
 *               "execution_condition": {
 *                 "message": {
 *                   "id": "http://eur-ledger.example/EUR/transfers/c92f2a2c-b21d-4e6c-96e7-4f6d6df4bee9",
 *                   "state": "executed"
 *                 },
 *                 "algorithm": "ed25519-sha512",
 *                 "public_key": "Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg="
 *               },
 *               "expires_at": "2015-06-16T00:00:02.000Z",
 *               "state": "prepared"
 *             }
 *           ],
 *           "criteria": {
 *             "$ref": "Transfer.json"
 *           }
 *         }
 *       ]
 *     }
 *
 * @apiErrorExample {json} 422 Unacceptable Rate
 *     HTTP/1.1 422 Unprocessable Entity
 *     {
 *       "id": "UnacceptableRateError",
 *       "message": "Settlement rate does not match the rate currently offered"
 *     }
 */
 /* eslint-enable */

exports.put = function *(id) {
  // TODO: check that this UUID hasn't been used before
  requestUtil.validateUriParameter('id', id, 'Uuid');
  let settlement = yield requestUtil.validateBody(this, 'Settlement');

  if (typeof settlement.id !== 'undefined') {
    requestUtil.assert.strictEqual(
      settlement.id,
      config.server.base_uri + this.originalUrl,
      'Settlement ID must match the one in the URL'
    );
  }

  settlement.id = id.toLowerCase();

  // TODO: Check expiry settings
  // TODO: Check ledger signature on source payment
  // TODO: Check ledger signature on destination payment

  log.debug('validating settlement ID: ' + settlement.id);

  // Note that some traders may facilitate many to many
  // settlements but this one will throw an error
  validateOneToManyOrManyToOne(settlement);

  validateSourceTransfersArePrepared(settlement);
  validateExpiry(settlement);
  yield validateRate(settlement);
  yield validateFee(settlement);
  validateExecutionConditions(settlement);
  yield validateExecutionConditionPublicKey(settlement);

  if (settlement.destination_fee_transfers) {
    log.debug('submitting destination fee transfers');
    addAuthorizationToTransfers(settlement.destination_fee_transfers);
    yield submitTransfers(settlement.destination_fee_transfers);
  }

  log.debug('submitting destination transfers');
  addAuthorizationToTransfers(settlement.destination_transfers);
  yield submitTransfers(settlement.destination_transfers,
    settlement.source_transfers);

  if (_.some(settlement.destination_transfers, function(transfer) {
        return transfer.state === 'executed';
      })) {
    yield executeSourceTransfers(settlement.source_transfers,
      settlement.destination_transfers);

    // TODO: is the settlement execute when the destination transfer
    // is execute or only once we've gotten paid back?
    settlement.state = 'executed';
  }

  // Externally we want to use a full URI ID
  settlement.id = config.server.base_uri + '/settlements/' + settlement.id;

  this.status = 201;
  this.body = settlement;
};
