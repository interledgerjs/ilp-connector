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

function * subscribeLedger (ledgerUri, ledgersService, config) {
  log.info('subscribing to ' + ledgerUri)
  const ledger = ledgersService.getLedger(ledgerUri)

  ledger.on('incoming', (resource, relatedResources) => {
    co(function * () {
      yield payments.updateTransfer(resource, relatedResources, ledgersService, config)
    }).catch((err) => {
      log.warn('error processing notification: ' + err)
    })
  })
  ledger.connect()
}

module.exports = {
  subscribePairs,
  subscribeLedger
}
