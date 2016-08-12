'use strict'

const _ = require('lodash')
const co = require('co')
const log = require('../common').log.create('subscriptions')
const payments = require('../models/payments')

function * setupListeners (core, config, routeBuilder) {
  const handleIncoming = (client, transfer) => {
    return co(function * () {
      yield payments.updateIncomingTransfer(transfer, core, config, routeBuilder)
    }).catch((err) => {
      log.warn('error processing notification: ' + err)
      throw err
    })
  }
  core.on('incoming_prepare', handleIncoming)
  core.on('incoming_transfer', handleIncoming)

  core.on('outgoing_fulfill', (client, transfer, fulfillment) => {
    return co(function * () {
      yield payments.processExecutionFulfillment(transfer, fulfillment, core, config)
    }).catch((err) => {
      log.warn('error processing notification: ' + err)
      throw err
    })
  })
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
  const client = core.getClient(ledgerUri)

  yield client.connect()
}

module.exports = {
  setupListeners,
  subscribePairs,
  subscribeLedger
}
