'use strict'

const jsonSigning = require('five-bells-shared').JSONSigning
const url = require('url')
const log = require('../common/log').create('notifications')
const AssetsNotTradedError = require('../errors/assets-not-traded-error')

function parseLedger (notificationId) {
  const parsedUrl = url.parse(notificationId)
  return parsedUrl.protocol + '//' + parsedUrl.host
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

function * processNotification (notification, core, config) {
  if (notification.event === 'transfer.update') {
    const plugin = core.resolvePlugin(notification.resource.ledger)
    if (!plugin) {
      throw new AssetsNotTradedError('Unexpected notification from unknown source ledger: ' +
        notification.resource.ledger)
    }
    yield plugin._handleNotification(
      notification.resource, notification.related_resources, core, config)
  }
}

module.exports = {
  verifySignature: verifySignature,
  processNotification: processNotification
}
