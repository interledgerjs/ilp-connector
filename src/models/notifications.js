'use strict'

const payments = require('./payments')

function * processNotification (notification, ledgers, config) {
  if (notification.event === 'transfer.update') {
    yield payments.updateTransfer(
      notification.resource, notification.related_resources, ledgers, config)
  }
}

module.exports = {
  processNotification: processNotification
}
