'use strict'

const co = require('co')
const log = require('../common').log.create('subscriptions')
const payments = require('../models/payments')

function * subscribePairs (ledgers, config, routeBuilder, backend) {
  const handleIncoming = (plugin, transfer) => {
    return co(function * () {
      yield payments.updateIncomingTransfer(transfer, ledgers, config, routeBuilder)
    }).catch(logThenThrow)
  }
  ledgers.on('incoming_prepare', handleIncoming)
  ledgers.on('incoming_transfer', handleIncoming)

  ledgers.on('outgoing_cancel', (plugin, transfer, rejectionMessage) => {
    return co(payments.rejectSourceTransfer, transfer, rejectionMessage, ledgers)
      .catch(logThenThrow)
  })

  ledgers.on('outgoing_reject', (plugin, transfer, rejectionMessage) => {
    return co(payments.rejectSourceTransfer, transfer, rejectionMessage, ledgers)
      .catch(logThenThrow)
  })

  ledgers.on('outgoing_fulfill', (plugin, transfer, fulfillment) => {
    return co(function * () {
      yield payments.processExecutionFulfillment(transfer, fulfillment, ledgers, backend, config)
    }).catch(logThenThrow)
  })
}

function logThenThrow (err) {
  log.warn('error processing notification: ' + err)
  throw err
}

module.exports = { subscribePairs }
