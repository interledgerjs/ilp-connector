'use strict'

const _ = require('lodash')
const co = require('co')
const log = require('../common').log('subscriptions')
const payments = require('../models/payments')

function * subscribePairs (pairs, ledgersService, config) {
  let ledgers = _(pairs)
    .flatten()
    .map(function (d) {
      return d.split('@').slice(1).join('@')
    })
    .uniq()
    .value()

  // Subscribe to all ledgers in parallel.
  yield ledgers.map((l) => subscribeLedger(l, ledgersService, config))
}

function * subscribeLedger (ledger, ledgersService, config) {
  log.info('subscribing to ' + ledger)
  yield ledgersService.subscribe(ledger, (resource, relatedResources) => {
    co(function * () {
      yield payments.updateTransfer(resource, relatedResources, ledgersService, config)
    }).catch((err) => {
      log.warn('error processing notification: ' + err)
    })
  })
}

module.exports = {
  subscribePairs,
  subscribeLedger
}
