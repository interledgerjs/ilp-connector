'use strict'

const _ = require('lodash')
const co = require('co')
const log = require('../common').log.create('subscriptions')
const payments = require('../models/payments')

function * setupListeners (core, config, routeBuilder, messageRouter) {
  const handleIncoming = (client, transfer) => {
    return co(function * () {
      yield payments.updateIncomingTransfer(transfer, core, config, routeBuilder)
    }).catch(logThenThrow)
  }
  core.on('incoming_prepare', handleIncoming)
  core.on('incoming_transfer', handleIncoming)

  core.on('outgoing_cancel', (client, transfer, rejectionMessage) => {
    return co(payments.rejectSourceTransfer, transfer, rejectionMessage, core)
      .catch(logThenThrow)
  })

  core.on('outgoing_reject', (client, transfer, rejectionMessage) => {
    return co(payments.rejectSourceTransfer, transfer, rejectionMessage, core)
      .catch(logThenThrow)
  })

  core.on('outgoing_fulfill', (client, transfer, fulfillment) => {
    return co(function * () {
      yield payments.processExecutionFulfillment(transfer, fulfillment, core, config)
    }).catch(logThenThrow)
  })

  core.on('incoming_message', (client, message) => {
    return messageRouter.handleMessage(message)
      .catch(logThenThrow)
  })
}

function logThenThrow (err) {
  log.warn('error processing notification: ' + err)
  throw err
}

function * subscribePairs (pairs, core, config, routeBuilder, messageRouter) {
  yield this.setupListeners(core, config, routeBuilder, messageRouter)

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

function * subscribeLedger (ledgerPrefix, core, config) {
  log.info('subscribing to ' + ledgerPrefix)
  const client = core.getClient(ledgerPrefix)

  // Disable connect() timeout
  yield client.connect({timeout: 0})
}

module.exports = {
  setupListeners,
  subscribePairs,
  subscribeLedger
}
