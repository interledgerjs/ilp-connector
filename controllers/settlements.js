'use strict';

const _ = require('lodash');
const crypto = require('crypto');
const request = require('co-request');
const stringifyJson = require('canonical-json');
const requestUtil = require('five-bells-shared/utils/request');
const log = require('five-bells-shared/services/log')('settlements');
const executeSourceTransfers = require('../lib/executeSourceTransfers');
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
const hashJSON = require('five-bells-shared/utils/hashJson');

function sourceConditionIsDestinationTransfer(source, destination) {
  // Check the message or message_hash
  let expectedMessage = {
    id: destination.id,
    state: 'executed'
  };

  if (source.execution_condition.message &&
      !_.isEqual(source.execution_condition.message, expectedMessage)) {
    log.info('invalid condition, unexpected message');
    return false;
  }
  if (source.execution_condition.message_hash &&
      source.execution_condition.message_hash !== hashJSON(expectedMessage)) {
    log.info('invalid condition, unexpected message hash');
    return false;
  }

  // Check the signer
  if (source.execution_condition.signer &&
      source.execution_condition.signer !== destination.ledger) {
    log.info('invalid condition, unexpected signer');
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
    let sourceLedger = settlement.source_transfers[0].ledger;
    let rates = {};
    for (let transfer of settlement.destination_transfers) {
      rates[transfer.ledger] =
        yield fxRates.get(sourceLedger, transfer.ledger);
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

        let offeredRate = rates[transfer.ledger];
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
    let destinationLedger = settlement.destination_transfers[0].ledger;
    let rates = {};
    for (let transfer of settlement.source_transfers) {
      rates[transfer.ledger] =
        yield fxRates.get(transfer.ledger, destinationLedger);
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

        let offeredRate = rates[transfer.ledger];
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

    if (destinationTransferReq.body.state === 'executed') {
      log.debug('executed destination transfer');
      destinationTransfer.execution_condition_fulfillment =
        destinationTransferReq.body.execution_condition_fulfillment;
    } else {
      // Store this subscription so when we get the notification
      // we know what source transfer to go and unlock
      log.debug('destination transfer not yet executed, ' +
        'added subscription record');
      subscriptionRecords.put(destinationTransfer.id,
        settlement.source_transfers);
    }
  }
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
  yield validateRate(settlement);
  validateExecutionConditions(settlement);
  yield validateExecutionConditionPublicKey(settlement);

  addAuthorizationToDestinationTransfers(settlement);
  yield submitDestinationTransfers(settlement);

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
