'use strict'

const payments = require('./payments')

function * processNotification (notification) {
  if (notification.event === 'transfer.update') {
    yield payments.updateTransfer(notification.resource, notification.related_resources)
  }
}

module.exports = {
  processNotification: processNotification
}
