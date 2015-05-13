'use strict';

const _ = require('lodash');
const requestUtil = require('five-bells-shared/utils/request');
const log = require('five-bells-shared/services/log')('notifications');
const subscriptionRecords = require('../services/subscriptionRecords');
const executeSourceTransfers = require('../lib/executeSourceTransfers');
const UnrelatedNotificationError =
  require('../errors/unrelated-notification-error');

exports.post = function *postNotification() {
  let notification = yield requestUtil.validateBody(this, 'Notification');

  if (notification.event === 'transfer.update') {
    let destinationTransfer = notification.resource;
    let sourceTransfers = subscriptionRecords.get(destinationTransfer.id);

    if (!sourceTransfers || sourceTransfers.length === 0) {
      // TODO: should we delete the subscription?
      throw new UnrelatedNotificationError('Notification does not match a ' +
        'settlement we have a record of or the corresponding source ' +
        'transfers may already have been executed');
    }

    if (notification.resource.state === 'executed') {

      // TODO: make sure the transfer is signed by the ledger

      log.debug('got notification about executed destination transfer');

      // This modifies the source_transfers states
      yield executeSourceTransfers(sourceTransfers, [destinationTransfer]);

      let allTransfersExecuted = _.every(sourceTransfers, function(transfer) {
        return transfer.state === 'executed';
      });
      if (!allTransfersExecuted) {
        log.error('not all source transfers have been executed, ' +
          'meaning we have not been fully repaid');
      }
    } else {
      log.debug('got notification about unknown or incomplete transfer');
    }
  }

  this.status = 200;
};
