'use strict'

const Payments = require('../services/payments')

function * processNotification (notification) {
  if (notification.event === 'transfer.update') {
    yield Payments.updateTransfer(notification.resource, notification.related_resources)
  }
}

module.exports = {
  processNotification: processNotification
}
