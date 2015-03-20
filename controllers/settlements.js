'use strict';

const _ = require('lodash');
const request = require('co-request');
const requestUtil = require('five-bells-shared/utils/request');
const log = require('five-bells-shared/services/log')('transfers');
const ExternalError = require('../errors/external-error');

exports.put = function *(id) {
  requestUtil.validateUriParameter('id', id, 'Uuid');
  let settlement = yield requestUtil.validateBody(this, 'Settlement');

  if (typeof settlement.id !== 'undefined') {
    requestUtil.assert.strictEqual(
      settlement.id,
      requestUtil.getBaseUri(this) + this.originalUrl,
      'Settlement ID must match the one in the URL'
    );
  }

  settlement.id = id;

  log.debug(`validating settlement ID ${settlement.id}`);

  // TODO: Check expiry settings

  // TODO: Check ledger signature on source payment
  // TODO: Check ledger signature on destination payment

  // We need to have confidence that the source transfer will actually happen.
  // So either it has to depend on something we control, namely the destination
  // transfer or the condition has to match whatever the condition of the
  // destination transfer is. (So we can just copy the condition's fulfillment.)
  let destinationCondition = {
    message: settlement.destination_transfer.id + ';state=executed',
    signer: settlement.destination_transfer
  };
  if (!_.isEqual(settlement.source_transfer.condition, destinationCondition) &&
      !_.isEqual(settlement.source_transfer.condition,
                 settlement.destination_transfer.condition)) {

    // Otherwise we'll reject the settlement transaction
    // XXX
    throw new Error();
  }

  // Add authorization to the destination transfer
  settlement.destination_transfer.debits[0].authorization = {
    algorithm: 'ed25519-sha512'
  };
  log.debug('adding auth to dest transfer');
  let req = yield request.put({
    uri: settlement.destination_transfer.id,
    body: settlement.destination_transfer,
    json: true
  });

  if (req.statusCode >= 400) {
    log.error('remote error while authorizing destination transfer');
    log.debug(req.body);
    throw new ExternalError('Received an unexpected ' + req.body.id +
      ' while processing destination transfer.');
  }

  settlement.source_transfer.execution_condition_fulfillment = {
    // TODO
  };

  log.debug('requesting fulfillment of source transfer');
  req = yield request.put({
    uri: settlement.source_transfer.id,
    body: settlement.source_transfer,
    json: true
  });

  if (req.statusCode >= 400) {
    log.error('remote error while fulfilling source transfer');
    log.debug(req.body);
    throw new ExternalError('Received an unexpected ' + req.body.id +
      ' while processing source transfer.');
  }

  log.debug('settlement completed');


  // Externally we want to use a full URI ID
  settlement.id = requestUtil.getBaseUri(this) + this.originalUrl;

  this.body = settlement;
};
