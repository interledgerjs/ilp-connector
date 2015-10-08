'use strict'
const request = require('co-request')
const sjclcodec = require('sjcl-codec')
const config = require('../../../services/config')
const utils = require('./utils')

// api     - TransferAPI
// options - {target_uri, event, uuid}
function Subscriber (api, options) {
  this.api = api
  this.trader_address = api.credentials.address
  this.target_uri = options.target_uri
  this.uuid = options.uuid
}

Subscriber.prototype.onTransaction = function * (notif) {
  let type = getTransactionType(notif)
  if (type === 'SuspendedPaymentFinish') {
    yield this.onSuspendedPaymentFinish(notif.transaction)
  }
}

Subscriber.prototype.onSuspendedPaymentFinish = function * (transaction) {
  let transfer = this.api.transferPool.findByTransaction(transaction)
  if (!transfer) {
    return
  }
  utils.setTransferState(transfer, 'executed')
  transfer.execution_condition_fulfillment = {
    type: methodToString(transaction.Method),
    message: hexToString(transaction.Proof)
  }
  // Notify ourselves so that the source transfers get executed.
  yield this.postTransfer(transfer)
  this.api.transferPool.remove(transfer)
}

Subscriber.prototype.postTransfer = function * (transfer) {
  let relayRes = yield request({
    method: 'post',
    url: this.target_uri,
    json: true,
    body: {
      id: config.server.base_uri + '/notifications/' + this.uuid,
      event: 'transfer.update',
      resource: transfer
    }
  })
  if (relayRes.statusCode !== 200) {
    throw new Error('Unexpected status from notifications post: ' +
      relayRes.statusCode)
  }
}

function methodToString (method) {
  if (method === 1) {
    return 'sha256'
  }
  throw new Error('Unsupported method ' + method)
}

function getTransactionType (notif) {
  return notif.engine_result === 'tesSUCCESS' &&
         notif.type === 'transaction' &&
         notif.validated &&
         notif.transaction &&
         notif.transaction.TransactionType
}

function hexToString (hexString) {
  const bits = sjclcodec.hex.toBits(hexString)
  return sjclcodec.utf8String.fromBits(bits)
}

module.exports = Subscriber
