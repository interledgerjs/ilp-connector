'use strict'

const payments = require('./payments')
const jsonSigning = require('five-bells-shared').JSONSigning
const url = require('url')
const log = require('../common/log')('notifications')

function parseLedger (notificationId) {
  const parsedUrl = url.parse(notificationId)
  return parsedUrl.protocol + '//' + parsedUrl.hostname
}

/**
 * Verifies signature on JSON
 * Signed used JCS format
 *
 * @param {object} notification - Signed notification object
 * @param {object} config - Config object
 * @returns {object} - valid: boolean, error: string
 */
function verifySignature (notification, config) {
  log.debug('Verifying signature')
  const ledgerUri = parseLedger(notification.id)
  const pubKey = config.getIn(['notifications', 'keys', ledgerUri])

  if (!pubKey) {
    throw new Error('Missing public key for ledger: ' + ledgerUri)
  }

  return jsonSigning.verify(notification, pubKey)
}

function * processNotification (notification, ledgers, config) {
  if (notification.event === 'transfer.update') {
    yield payments.updateTransfer(
      notification.resource, notification.related_resources, ledgers, config)
  }
}

module.exports = {
  verifySignature: verifySignature,
  processNotification: processNotification
}
