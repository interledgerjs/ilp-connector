'use strict';

const parse = require('co-body');
const request = require('co-request');
const log = require('five-bells-shared/services/log')('notifications');
const subscriptionRecords = require('../services/subscriptionRecords');

exports.post = function *postNotification() {
  const body = yield parse(this);
  if (body.event === 'transfer.update') {
    let transferId = body.resource.id;
    let correspondingSourceTransaction = subscriptionRecords.get(transferId);
    if (body.resource.state === 'completed' && correspondingSourceTransaction) {

      log.debug('got notification about completed destination_transfer');

      // Take execution_condition_fulfillment from the source transaction
      // that has been executed and send it to the source ledger
      // to unlock the money that's been held for us
      correspondingSourceTransaction.execution_condition_fulfillment =
        body.resource.execution_condition_fulfillment;

      let sourceTransactionReq = yield request({
        method: 'put',
        url: correspondingSourceTransaction.id,
        json: true,
        body: correspondingSourceTransaction
      });

      if (sourceTransactionReq.statusCode >= 400) {
        // TODO handle this so we actually get our money back
        log.error('error unlocking funds from source_transfer',
          sourceTransactionReq.body);
      } else {
        log.debug('unlocked source_transfer funds');
      }

      let removeSubscriptionReq = yield request({
        method: 'DELETE',
        uri: subscriptionId
      });
      if (removeSubscriptionReq.statusCode >= 400) {
        log.error('error removing subscription', removeSubscriptionReq.body);
      } else {
        log.debug('removed subscription', subscriptionId);
      }

      subscriptionRecords.remove(subscriptionId);
    }
  }

  this.status = 200;
};
