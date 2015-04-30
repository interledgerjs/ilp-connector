'use strict';

const _ = require('lodash');
const crypto = require('crypto');
const request = require('co-request');
const stringifyJson = require('canonical-json');
const requestUtil = require('five-bells-shared/utils/request');
const log = require('five-bells-shared/services/log')('settlements');
const config = require('../services/config');
const fxRates = require('../services/fxRates');
const subscriptionRecords = require('../services/subscriptionRecords');
const ExternalError = require('../errors/external-error');
const UnacceptableConditionsError =
  require('../errors/unacceptable-conditions-error');
const UnacceptableRateError = require('../errors/unacceptable-rate-error');
const NoRelatedSourceCreditError =
  require('../errors/no-related-source-credit-error');
const NoRelatedDestinationDebitError =
  require('../errors/no-related-destination-debit-error');
const FundsNotHeldError = require('../errors/funds-not-held-error');
const ManyToManyNotSupportedError =
  require('../errors/many-to-many-not-supported-error');
const InvalidBodyError = require('five-bells-shared/errors/invalid-body-error');

function hashJSON (json) {
  let str = stringifyJson(json);
  let hash = crypto.createHash('sha512').update(str).digest('base64');
  return hash;
}

function sourceConditionIsDestinationTransfer(source, destination) {

  // Check the message if it's there
  if (source.execution_condition.message &&
        (source.execution_condition.message.id !== destination.id ||
         source.execution_condition.message.state !== 'completed')) {
    return false;
  }

  // Check the message_hash
  let message = source.execution_condition.message;
  if (!message) {
    message = {
      id: destination.id,
      state: 'completed'
    };
  }
  if (source.execution_condition.message_hash !== hashJSON(message)) {
    return false;
  }

  // Check the signer
  if (source.execution_condition.signer &&
      source.execution_condition.signer !== destination.ledger) {
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
      'the source transfers\' conditions can be the completion of the ' +
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
            destinationTransferStateReq.body.algorithm ||
          sourceTransfer.execution_condition.public_key !==
            destinationTransferStateReq.body.public_key) {
        throw new UnacceptableConditionsError('Source and destination ' +
          'transfer execution conditions must match or the source ' +
          'transfer\'s condition must be the completion of the ' +
          'destination transfer');
      }
    }
  }
}

function validateSouceTransferIsPrepared(transfer) {
  if (transfer.state !== 'prepared' &&
      transfer.state !== 'completed') {
    throw new FundsNotHeldError('Source transfer must be in the prepared ' +
      'state for the trader to authorize the destination transfer');
  }
}

function validateSourceTransfersArePrepared (settlement) {
  log.debug('validating source transfer is prepared');
  _.forEach(settlement.source_transfers, validateSouceTransferIsPrepared);
}

function validateAssetsInTransfer (transfer) {
  function getAsset (creditOrDebit) {
    return creditOrDebit.asset;
  }

  // Make sure all the source transfer assets are the same
  let debitAssets =
    Object.keys(_.groupBy(transfer.debits, getAsset));
  let creditAssets =
    Object.keys(_.groupBy(transfer.credits, getAsset));
  if (debitAssets.length !== 1 ||
    creditAssets.length !== 1 ||
    debitAssets[0] !== creditAssets[0]) {
    throw new InvalidBodyError('Transfer cannot include multiple ' +
      'asset types');
  }

  // When we validate the rate it'll throw an error
  // if we don't actually trade this asset pair
}

function validateAssets (settlement) {
  log.debug('validating assets');
  _.forEach(settlement.source_transfers, validateAssetsInTransfer);
  _.forEach(settlement.destination_transfers, validateAssetsInTransfer);
}

function *validateRate (settlement) {

  // TODO: thoroughly check this logic

  log.debug('validating rate');

  function amountFinder (creditOrDebit) {
    // TODO: change this check when the account ids become IRIs
    return (creditOrDebit.account === config.id ?
      parseFloat(creditOrDebit.amount) :
      0);
  }

  if (settlement.source_transfers.length === 1) {
    // One to many

    // Get rates
    let sourceAsset = settlement.source_transfers[0].credits[0].asset;
    let rates = {};
    for (let transfer of settlement.destination_transfers) {
      let destinationAsset = transfer.debits[0].asset;
      rates[destinationAsset] =
        yield fxRates.get(sourceAsset, destinationAsset);
    }

    // Sum the credits to the trader's account in the source transfer
    // less the debits (which should be 0)
    let sourceCreditNet =
      _.sum(settlement.source_transfers[0].credits, amountFinder) -
      _.sum(settlement.source_transfers[0].debits, amountFinder);

    if (sourceCreditNet <= 0) {
      throw new NoRelatedSourceCreditError('Trader\'s account ' +
        'must be credited in all source transfers to provide settlement');
    }

    // For each of the destination transfers figure out the net debits
    // from the trader's account, then use the trader's rate to compute
    // how much of the source transfer asset that represents
    // Then, total that amount and compare it to the sourceCreditNet

    let destinationDebitsEquivalentInSourceAsset = _.sum(
      _.map(settlement.destination_transfers, function(transfer) {
        let destinationDebitNet = _.sum(transfer.debits, amountFinder) -
          _.sum(transfer.credits, amountFinder); // should be 0

        if (destinationDebitNet <= 0) {
          throw new NoRelatedDestinationDebitError('Trader\'s account ' +
            'must be debited in all destination transfers to ' +
            'provide settlement');
        }

        let offeredRate = rates[transfer.debits[0].asset];
        let sourceAssetEquivalent = destinationDebitNet / offeredRate;
        return sourceAssetEquivalent;
    }));

    if (destinationDebitsEquivalentInSourceAsset > sourceCreditNet) {
      log.error('client requested unacceptable rate');
      throw new UnacceptableRateError('Settlement rate does not match ' +
        'the rate currently offered');
    }

  } else {
    // Many to one

    // Get rates
    let destinationAsset = settlement.destination_transfers[0].credits[0].asset;
    let rates = {};
    for (let transfer of settlement.source_transfers) {
      let sourceAsset = transfer.credits[0].asset;
      rates[sourceAsset] =
        yield fxRates.get(sourceAsset, destinationAsset);
    }

    // Sum the debits from the trader's account in the destination transfer
    // less the credits (which should be 0)
    let destinationDebitNet =
      _.sum(settlement.destination_transfers[0].debits, amountFinder) -
      _.sum(settlement.destination_transfers[0].credits, amountFinder);

    if (destinationDebitNet <= 0) {
      throw new NoRelatedDestinationDebitError('Trader\'s account ' +
        'must be debited in all destination transfers to provide settlement');
    }

    // For each of the source transfers figure out the net credits
    // to the trader's account, then use the trader's rate to compute
    // how much of the destination asset that represents
    // Then, total that amount and compare it to the destinationDebitNet

    let sourceCreditsEquivalentInDestinationAsset = _.sum(
      _.map(settlement.source_transfers, function(transfer) {
        let sourceCreditNet = _.sum(transfer.credits, amountFinder) -
          _.sum(transfer.debits, amountFinder); // should be 0

        if (sourceCreditNet <= 0) {
          throw new NoRelatedSourceCreditError('Trader\'s account ' +
            'must be credited in all source transfers to provide settlement');
        }

        let offeredRate = rates[transfer.credits[0].asset];
        let destinationAssetEquivalent = sourceCreditNet * offeredRate;
        return destinationAssetEquivalent;
    }));

    if (sourceCreditsEquivalentInDestinationAsset < destinationDebitNet) {
      log.error('client requested unacceptable rate');
      throw new UnacceptableRateError('Settlement rate does not match ' +
        'the rate currently offered');
    }
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
function addAuthorizationToDestinationTransfers (settlement) {
  // TODO: actually sign it
  log.debug('adding auth to dest transfers');
  _.forEach(settlement.destination_transfers, function(destinationTransfer) {
    _.forEach(destinationTransfer.debits, function(debit) {
      if (debit.account === config.id) {
        debit.authorization = {
          algorithm: 'ed25519-sha512'
        };
      }
    })
  });
}

function *submitDestinationTransfers (settlement) {

  log.debug('submitting destination transfers');

  for (let destinationTransfer of settlement.destination_transfers) {
    let destinationTransferReq = yield request({
      method: 'put',
      uri: destinationTransfer.id,
      body: destinationTransfer,
      json: true
    });

    if (destinationTransferReq.statusCode >= 400) {
      log.error('remote error while authorizing destination transfer');
      log.debug(destinationTransferReq.body);
      throw new ExternalError('Received an unexpected ' +
        destinationTransferReq.body.id +
        ' while processing destination transfer.');
    }

    // Update destination_transfer state from the ledger's response
    destinationTransfer.state = destinationTransferReq.body.state;

    if (destinationTransferReq.body.state === 'completed') {
      destinationTransfer.execution_condition_fulfillment =
        destinationTransferReq.body.execution_condition_fulfillment;
    } else {
      // Store this subscription so when we get the notification
      // we know what source transfer to go and unlock
      subscriptionRecords.put(destinationTransfer.id,
        settlement.source_transfers);
    }
  }
}

function *addConditionFulfillmentToSourceTransfers (settlement) {

  for (let sourceTransfer of settlement.source_transfers) {

    // Check if the source transfer's execution_condition is
    // the completion of the destination transfer
    let conditionsAreEqual =
      sourceConditionSameAsAllDestinationConditions(
        sourceTransfer, settlement.destination_transfers);

    if (conditionsAreEqual) {

      let transferWithConditionFulfillment = _.find(
        settlement.destination_transfers, function(transfer) {
          return transfer.execution_condition_fulfillment;
        });

      if (transferWithConditionFulfillment) {
        sourceTransfer.execution_condition_fulfillment =
          transferWithConditionFulfillment.execution_condition_fulfillment;
      }
      // else {
        // TODO: what do we do if none of the destination transfers
        // have the condition fulfillment attached?
      // }

    } else {

      // we know there is only one destination transfer

      let destinationTransferStateReq = yield request({
        method: 'get',
        uri: settlement.destination_transfers[0].id + '/state',
        json: true
      });

      // TODO: add retry logic
      if (destinationTransferStateReq.statusCode >= 400) {
        log.error('remote error while checking destination transfer state');
        throw new ExternalError('Received an unexpected ' +
          destinationTransferStateReq.body.id +
          ' while checking destination transfer state ' +
          settlement.destination_transfers[0].id);
      }

      // TODO: validate that this actually comes back in the right format
      // TODO: what do we do if the state isn't completed?
      sourceTransfer.execution_condition_fulfillment =
        destinationTransferStateReq.body;
    }
  }
}

// Add the execution_condition_fulfillment to the source transfer
// and submit it to the source ledger
function *executeSourceTransfers (settlement) {

  yield addConditionFulfillmentToSourceTransfers(settlement);

  for (let sourceTransfer of settlement.source_transfers) {

    log.debug('requesting fulfillment of source transfer');
    let sourceTransferReq = yield request({
      method: 'put',
      uri: sourceTransfer.id,
      body: sourceTransfer,
      json: true
    });

    // Update source_transfer state from the ledger's response
    sourceTransfer.state = sourceTransferReq.body.state;

    if (sourceTransferReq.statusCode >= 400) {
      log.error('remote error while fulfilling source transfer');
      log.debug(JSON.stringify(sourceTransferReq.body));
      throw new ExternalError('Received an unexpected ' +
        sourceTransferReq.body.id +
        ' while processing source transfer ' + sourceTransfer.id);
    }

  }

  log.debug('settlement completed');
}

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
  validateAssets(settlement);
  yield validateRate(settlement);
  validateExecutionConditions(settlement);
  yield validateExecutionConditionPublicKey(settlement);

  addAuthorizationToDestinationTransfers(settlement);
  yield submitDestinationTransfers(settlement);

  if (_.some(settlement.destination_transfers, function(transfer) {
        return transfer.state === 'completed';
      })) {
    yield executeSourceTransfers(settlement);

    // TODO: is the settlement complete when the destination transfer
    // is complete or only once we've gotten paid back?
    settlement.state = 'completed';
  }

  // Externally we want to use a full URI ID
  settlement.id = config.server.base_uri + '/settlements/' + settlement.id;

  this.status = 201;
  this.body = settlement;
};
