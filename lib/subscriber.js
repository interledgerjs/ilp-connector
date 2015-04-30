'use strict';

const _ = require('lodash');
const request = require('co-request');
const log = require('five-bells-shared/services/log')('subscriber');
const config = require('../services/config');
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
    yield request({
      method: 'put',
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

  if (config.features.debugAutoFund) {
    log.info('creating account at ' + ledger);
    try {
      yield request({
        method: 'put',
        url: 'http://' + ledger + '/accounts/' + config.id,
        json: true,
        body: {
          name: config.id,
          balance: '1500000',
          identity: config.server.base_uri
        }
      });
    } catch (err) {
      log.warn('could not reach ledger ' + ledger);
    }
  }
};

exports.Subscriber = Subscriber;
