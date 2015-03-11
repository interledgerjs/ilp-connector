'use strict';

const _ = require('lodash');
const requestUtil = require('../services/request');
const log = require('../services/log')('transfers');

exports.put = function *(id) {
  requestUtil.validateUriParameter('id', id, 'Uuid');
  let settlement = yield requestUtil.body(this, 'Transfer');

  if (typeof settlement.id !== 'undefined') {
    requestUtil.assert.strictEqual(
      settlement.id,
      id,
      'Settlement ID must match the one in the URL'
    );
  } else {
    settlement.id = id;
  }

  log.debug(`validating settlement ID ${settlement.id}`);

  // TODO: Check expiry settings

  // TODO: Check signature on source payment
  // TODO: Check signature on destination payment

  // We need to have confidence that the source transfer will actually happen.
  // So either it has to depend on something we control, namely the destination
  // transfer or the condition has to match whatever the condition of the
  // destination transfer is.
  let destinationCondition = {
    message: `${settlement.destination_transfer.id};state=executed`,
    signer: settlement.destination_transfer
  };
  if (!_.isEqual(settlement.source_transfer.condition, destinationCondition) &&
      !_.isEqual(settlement.source_transfer.condition,
                 settlement.destination_transfer.condition)) {

    // Otherwise we'll reject the settlement transaction
    // XXX
    throw new Error()
  }


};
