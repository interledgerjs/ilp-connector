'use strict'

const _ = require('lodash')
const log = require('../services/log')('subscriber')
const ledgers = require('./ledgers')
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

  // Subscribe to all ledgers in parallel.
  yield ledgers.map(this.subscribeLedger.bind(this))
}

Subscriber.prototype.subscribeLedger = function * (ledger) {
  log.info('subscribing to ' + ledger)
  yield ledgers.subscribe(ledger, {
    target_uri: this.config.server.base_uri + '/notifications',
    event: 'transfer.create',
    uuid: notificationUuid
  })
}

exports.Subscriber = Subscriber
