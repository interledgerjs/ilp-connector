'use strict'

const _ = require('lodash')
const co = require('co')
const log = require('../common').log.create('subscriptions')
const payments = require('../models/payments')

function * setupListeners (ledgersService, config, routeBuilder) {
  for (let ledger of _.values(ledgersService.getLedgers())) {
    ledger.on('receive', (transfer) => {
      return co(function * () {
        const transferWithLedger = Object.assign({}, transfer, { ledger: ledger.id })
        yield payments.updateIncomingTransfer(transferWithLedger, ledgersService, config, routeBuilder)
      }).catch((err) => {
        log.warn('error processing notification: ' + err)
        throw err
      })
    })
    ledger.on('fulfill_execution_condition', (transfer, fulfillment) => {
      return co(function * () {
        const transferWithLedger = Object.assign({}, transfer, { ledger: ledger.id })
        yield payments.processExecutionFulfillment(transferWithLedger, fulfillment, ledgersService, config)
      }).catch((err) => {
        log.warn('error processing notification: ' + err)
        throw err
      })
    })
  }
}

function * subscribePairs (pairs, ledgersService, config, routeBuilder) {
  yield this.setupListeners(ledgersService, config, routeBuilder)

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

  yield ledger.connect()
}

module.exports = {
  setupListeners,
  subscribePairs,
  subscribeLedger
}
