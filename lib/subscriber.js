'use strict'

const _ = require('lodash')
const log = require('../services/log')('subscriber')
const ledgers = require('./ledgers')

function Subscriber (config) {
  this.config = config
}

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
  yield ledgers.subscribe(ledger, this.config.server.base_uri + '/notifications')
}

exports.Subscriber = Subscriber
