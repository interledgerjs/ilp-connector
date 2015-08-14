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

  try {
    yield request({
      method: 'put',
      url: ledger + '/subscriptions/' + notificationUuid,
      json: true,
      body: {
        owner: this.config.id,
        event: 'transfer.create',
        target: this.config.server.base_uri + '/notifications'
      }
    })
  } catch (err) {
    log.warn('could not subscribe to ledger ' + ledger)
  }

  if (config.features.debugAutoFund) {
    log.info('creating account at ' + ledger)
    try {
      yield request({
        method: 'put',
        url: ledger + '/accounts/' + config.id,
        json: true,
        body: {
          name: config.id,
          balance: '1500000',
          identity: config.server.base_uri
        }
      })
    } catch (err) {
      log.warn('could not create account at ledger ' + ledger)
    }
  }
}

exports.Subscriber = Subscriber
