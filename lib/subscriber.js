'use strict';

const _ = require('lodash');
const request = require('co-request');
const log = require('five-bells-shared/services/log')('subscriber');
const uuid = require('uuid4');

function Subscriber(config) {
  this.config = config;
}

// By using a single constant UUID we avoid duplicate subscriptions
// TODO Obviously that is a hack and will need to change eventually
const notificationUuid = uuid();

Subscriber.prototype.subscribePairs = function *(pairs) {
  let ledgers = _(pairs)
    .map(function (d) {
      return d.split(';');
    })
    .flatten()
    .uniq()
    .value();

  for (let ledger of ledgers) {
    ledger = ledger.split('/').slice(1).join('/');
    yield *this.subscribeLedger(ledger);
  }
};

Subscriber.prototype.subscribeLedger = function *(ledger) {
  log.info('subscribing to ' + ledger);

  try {
    yield request.put({
      url: 'http://' + ledger + '/subscriptions/' + notificationUuid,
      json: true,
      body: {
        owner: this.config.id,
        event: 'transfer.create',
        target: this.config.server.base_uri + '/notifications'
      }
    });
  } catch (err) {
    log.warn('could not reach ledger ' + ledger);
  }
};

exports.Subscriber = Subscriber;
