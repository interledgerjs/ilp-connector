'use strict'

const _ = require('lodash')
const request = require('co-request')
const log = require('../services/log')('subscriber')
const config = require('../services/config')
const uuid = require('uuid4')

function Subscriber (config) {
  this.config = config
}

// By using a single constant UUID we avoid duplicate subscriptions
// TODO Obviously that is a hack and will need to change eventually
const notificationUuid = uuid()

Subscriber.prototype.subscribePairs = function *(pairs) {
  let ledgers = _(pairs)
    .flatten()
    .map(function (d) {
      return d.split('@').slice(1).join('@')
    })
    .uniq()
    .value()

  for (let ledger of ledgers) {
    yield *this.subscribeLedger(ledger)
  }
}

Subscriber.prototype.subscribeLedger = function *(ledger) {
  log.info('subscribing to ' + ledger)

  let account_uri = this.config.ledgerCredentials[ledger].account_uri
  yield request_retry({
    method: 'put',
    url: ledger + '/subscriptions/' + notificationUuid,
    json: true,
    body: {
      owner: account_uri,
      event: 'transfer.create',
      target: this.config.server.base_uri + '/notifications'
    }
  }, 'could not subscribe to ledger ' + ledger)

  if (config.features.debugAutoFund) {
    log.info('creating account at ' + ledger)
    yield request_retry({
      method: 'put',
      url: account_uri,
      json: true,
      body: {
        name: account_uri,
        balance: '1500000',
        identity: config.server.base_uri
      }
    }, 'could not create account at ledger ' + ledger)
  }
}

function * request_retry (opts, error_msg) {
  while (true) {
    try {
      yield request(opts)
      return
    } catch (err) {
      log.warn(error_msg)
      yield wait(1000)
    }
  }
}

function wait (ms) {
  return function (done) {
    setTimeout(done, ms)
  }
}

exports.Subscriber = Subscriber
