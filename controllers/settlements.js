'use strict';

const _ = require('lodash');
const request = require('co-request');
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

  // TODO: Check ledger signature on source payment
  // TODO: Check ledger signature on destination payment

  // We need to have confidence that the source transfer will actually happen.
  // So either it has to depend on something we control, namely the destination
  // transfer or the condition has to match whatever the condition of the
  // destination transfer is. (So we can just copy the condition's fulfillment.)
  let destinationCondition = {
    message: `${settlement.destination_transfer.id};state=executed`,
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
  settlement.destination_transfer.source_funds[0].authorization = {
    algorithm: 'ed25519-sha512'
  };
  console.log('adding auth to dest transfer');
  let req = yield request.put({
    uri: 'http://' + settlement.destination_transfer.source_funds[0].ledger +
         '/transfer/' + settlement.destination_transfer.id,
    body: settlement.destination_transfer,
    json: true
  });

  if (req.status >= 400) {
    // TODO
    throw new Error();
  }
};
