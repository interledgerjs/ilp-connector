'use strict';

const _ = require('lodash');
const crypto = require('crypto');
const request = require('co-request');
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
const InvalidBodyError = require('five-bells-shared/errors/invalid-body-error');

function hashJSON (json) {
  let str = JSON.stringify(json);
  let hash = crypto.createHash('sha512').update(str).digest('base64');
  return hash;
}

function generateConditionFromDestinationTransfer (settlement) {
  let destinationConditionMessage = {
    id: settlement.destination_transfer.id,
    state: 'completed'
  };
  let destinationCondition = {
    signer: settlement.destination_transfer.debits[0].ledger,
    messageHash: hashJSON(destinationConditionMessage)
  };
  return destinationCondition;
}

function validateExecutionConditions (ctx, settlement) {
  // We need to have confidence that the source transfer will actually happen.
  // So either it has to depend on something we control, namely the destination
  // transfer or the condition has to match whatever the condition of the
  // destination transfer is. (So we can just copy the condition's fulfillment.)
  let destinationCondition =
    generateConditionFromDestinationTransfer(settlement);

  if (!_.isEqual(settlement.source_transfer.execution_condition,
                 destinationCondition) &&
      !_.isEqual(settlement.source_transfer.execution_condition,
                 settlement.destination_transfer.execution_condition)) {

    throw new UnacceptableConditionsError('Source and destination transfer ' +
      'execution conditions must match or the source transfer\'s condition ' +
      'must be the completion of the destination transfer');
  }
}

function validateAssets (settlement) {
  function getAsset (creditOrDebit) {
    return creditOrDebit.asset;
  }

  // Make sure all the source transfer assets are the same
  let sourceDebitAssets =
    Object.keys(_.groupBy(settlement.source_transfer.debits, getAsset));
  let sourceCreditAssets =
    Object.keys(_.groupBy(settlement.source_transfer.credits, getAsset));
  if (sourceDebitAssets.length !== 1 ||
    sourceCreditAssets.length !== 1 ||
    sourceDebitAssets[0] !== sourceCreditAssets[0]) {
    throw new InvalidBodyError('Source transfer cannot include multiple ' +
      'asset types');
  }

  // Make sure the destination transfer assets are the same
  let destinationDebitAssets =
    Object.keys(_.groupBy(settlement.destination_transfer.debits, getAsset));
  let destinationCreditAssets =
    Object.keys(_.groupBy(settlement.destination_transfer.credits, getAsset));
  if (destinationDebitAssets.length !== 1 ||
    destinationCreditAssets.length !== 1 ||
    destinationDebitAssets[0] !== destinationCreditAssets[0]) {
    throw new InvalidBodyError('Destination transfer cannot include multiple ' +
      'asset types');
  }

  // When we validate the rate it'll throw an error
  // if we don't actually trade this asset pair
}

function *validateRate (settlement) {

  function amountFinder (creditOrDebit) {
    // TODO: change this check when the account ids become IRIs
    return (creditOrDebit.account === config.id ?
      parseFloat(creditOrDebit.amount) :
      0);
  }

  let sourceCreditTotal =
    _.sum(settlement.source_transfer.credits, amountFinder);
  let sourceDebitTotal =
    _.sum(settlement.source_transfer.debits, amountFinder); // should be 0
  let destinationCreditTotal =
    _.sum(settlement.destination_transfer.credits, amountFinder); // should be 0
  let destinationDebitTotal =
    _.sum(settlement.destination_transfer.debits, amountFinder);

  if (sourceCreditTotal === 0) {
    throw new NoRelatedSourceCreditError('Trader\'s account must be ' +
      'credited in source transfer to provide settlement');
  }

  if (destinationDebitTotal === 0) {
    throw new NoRelatedDestinationDebitError('Trader\'s account must be ' +
      'debited in destination transfer to provide settlement');
  }

  let rate = (destinationDebitTotal - destinationCreditTotal) /
    (sourceCreditTotal - sourceDebitTotal);

  let offeredRate = yield fxRates.get(
    settlement.source_transfer.credits[0].asset,
    settlement.destination_transfer.debits[0].asset);

  // TODO: double check that this is evaluating the rate correctly
  if (rate > offeredRate) {
    log.error('client requested unacceptable rate');
    throw new UnacceptableRateError('Settlement rate does not match ' +
      'the rate currently offered');
  }
}

// Note this modifies the original object
function addAuthorizationToDestinationTransfer (settlement) {
  // TODO: actually sign it
  log.debug('adding auth to dest transfer');
  settlement.destination_transfer.debits[0].authorization = {
    algorithm: 'ed25519-sha512'
  };
}

function *submitDestinationTransfer (settlement) {

  let destinationTransferReq = yield request({
    method: 'put',
    uri: settlement.destination_transfer.id,
    body: settlement.destination_transfer,
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
  settlement.destination_transfer.state = destinationTransferReq.body.state;

  if (destinationTransferReq.body.state === 'completed') {
    settlement.destination_transfer.execution_condition_fulfillment =
      destinationTransferReq.body.execution_condition_fulfillment;
  } else {
    // Store this subscription so when we get the notification
    // we know what source transfer to go and unlock
    subscriptionRecords.put(settlement.destination_transfer.id,
      settlement.source_transfer);
  }
}

function addConditionFulfillmentToSourceTransfer (settlement) {

  // Check if the source transfer's execution_condition is
  // the completion of the destination transfer
  let destinationCondition =
    generateConditionFromDestinationTransfer(settlement);

  if (_.isEqual(destinationCondition,
      settlement.source_transfer.execution_condition)) {
    // TODO: get the signed receipt from the ledger
    settlement.source_transfer.execution_condition_fulfillment = {
      signer: settlement.source_transfer.execution_condition.signer,
      messageHash: hashJSON({
        id: settlement.destination_transfer.id,
        state: settlement.destination_transfer.state
      })
    };
  } else {
    // It must be the same as the destination_transfer
    settlement.source_transfer.execution_condition_fulfillment =
      settlement.destination_transfer.execution_condition_fulfillment;
  }
}

// Add the execution_condition_fulfillment to the source transfer
// and submit it to the source ledger
function *executeSourceTransfer (settlement) {

  addConditionFulfillmentToSourceTransfer(settlement);

  log.debug('requesting fulfillment of source transfer');
  let sourceTransferReq = yield request({
    method: 'put',
    uri: settlement.source_transfer.id,
    body: settlement.source_transfer,
    json: true
  });

  // Update source_transfer state from the ledger's response
  settlement.source_transfer.state = sourceTransferReq.body.state;

  if (sourceTransferReq.statusCode >= 400) {
    log.error('remote error while fulfilling source transfer');
    log.debug(JSON.stringify(sourceTransferReq.body));
    throw new ExternalError('Received an unexpected ' +
      sourceTransferReq.body.id +
      ' while processing source transfer ' + settlement.source_transfer.id);
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
  validateExecutionConditions(this, settlement);
  validateAssets(settlement);
  yield validateRate(settlement);

  addAuthorizationToDestinationTransfer(settlement);
  yield submitDestinationTransfer(settlement);

  if (settlement.destination_transfer.state === 'completed') {
    yield executeSourceTransfer(settlement);

    // TODO: is the settlement complete when the destination transfer
    // is complete or only once we've gotten paid back?
    settlement.state = 'completed';
  }

  // Externally we want to use a full URI ID
  settlement.id = config.server.base_uri + '/settlements/' + settlement.id;

  this.status = 201;
  this.body = settlement;
};
