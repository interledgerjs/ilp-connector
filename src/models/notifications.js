'use strict'

const payments = require('./payments')

function * processNotification (notification, config, backend, ledgers) {
  if (notification.event === 'transfer.update') {
    yield payments.updateTransfer(
      notification.resource, notification.related_resources, config, backend, ledgers)
  }
}

module.exports = {
  processNotification: processNotification
}
