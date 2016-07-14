'use strict'

const _ = require('lodash')
const co = require('co')
const log = require('../common').log.create('subscriptions')
const payments = require('../models/payments')

function * setupListeners (core, config, routeBuilder) {
  for (let client of core.getClients()) {
    const ledger = yield client.getPlugin().getPrefix()
    client.on('receive', (transfer) => {
      return co(function * () {
        const transferWithLedger = Object.assign({}, transfer, {ledger})
        yield payments.updateIncomingTransfer(transferWithLedger, core, config, routeBuilder)
      }).catch((err) => {
        log.warn('error processing notification: ' + err)
        throw err
      })
    })
    client.on('fulfill_execution_condition', (transfer, fulfillment) => {
      return co(function * () {
        const transferWithLedger = Object.assign({}, transfer, {ledger})
        yield payments.processExecutionFulfillment(transferWithLedger, fulfillment, core, config)
      }).catch((err) => {
        log.warn('error processing notification: ' + err)
        throw err
      })
    })
  }
}

function * subscribePairs (pairs, core, config, routeBuilder) {
  yield this.setupListeners(core, config, routeBuilder)

  let ledgers = _(pairs)
    .flatten()
    .map(function (d) {
      return d.split('@').slice(1).join('@')
    })
    .uniq()
    .value()

  // Subscribe to all ledgers in parallel.
  yield ledgers.map((l) => subscribeLedger(l, core, config))
}

function * subscribeLedger (ledgerUri, core, config) {
  log.info('subscribing to ' + ledgerUri)
  const client = core.resolve(ledgerUri)

  yield client.connect()
}

module.exports = {
  setupListeners,
  subscribePairs,
  subscribeLedger
}
