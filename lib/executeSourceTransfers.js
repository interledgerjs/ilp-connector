'use strict';

const _ = require('lodash');
const request = require('co-request');
const log = require('five-bells-shared/services/log')('settlements');
const ExternalError = require('../errors/external-error');

function *addConditionFulfillments (source_transfers, destination_transfers) {

  for (let sourceTransfer of source_transfers) {

    // Check if the source transfer's execution_condition is
    // the completion of the destination transfer
    let conditionsAreEqual = _.every(destination_transfers,
      function(destinationTransfer) {
        return _.isEqual(sourceTransfer.execution_condition,
          destinationTransfer.execution_condition);
      });

    if (conditionsAreEqual) {

      let transferWithConditionFulfillment = _.find(
        destination_transfers, function(transfer) {
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
        uri: destination_transfers[0].id + '/state',
        json: true
      });

      // TODO: add retry logic
      if (destinationTransferStateReq.statusCode >= 400) {
        log.error('remote error while checking destination transfer state');
        throw new ExternalError('Received an unexpected ' +
          destinationTransferStateReq.body.id +
          ' while checking destination transfer state ' +
          destination_transfers[0].id);
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
function *executeSourceTransfers (source_transfers, destination_transfers) {

  yield addConditionFulfillments(source_transfers, destination_transfers);

  for (let sourceTransfer of source_transfers) {

    log.debug('requesting fulfillment of source transfer');
    let sourceTransferReq = yield request({
      method: 'put',
      uri: sourceTransfer.id,
      body: sourceTransfer,
      json: true
    });

    // TODO handle this so we actually get our money back
    if (sourceTransferReq.statusCode >= 400) {
      log.error('remote error while fulfilling source transfer');
      log.debug(JSON.stringify(sourceTransferReq.body));
      throw new ExternalError('Received an unexpected ' +
        sourceTransferReq.body.id +
        ' while processing source transfer ' + sourceTransfer.id);
    }

    // Update source_transfer state from the ledger's response
    sourceTransfer.state = sourceTransferReq.body.state;

    if (sourceTransfer.state !== 'completed') {
      log.error('Attempted to execute source transfer but it was unsucessful');
      log.debug(sourceTransfer);
    }

  }
}

module.exports = executeSourceTransfers;
