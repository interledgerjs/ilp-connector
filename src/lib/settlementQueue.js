'use strict'

/**
 * `records` is keyed by transfer_id. Each record stores a source `transfer`
 * that has state=prepared|executed and the `payment` to which it belongs.
 *
 * The `transfer` arrives over a notification from the ledger, so its state is
 * trusted. The transfers on the `payment` came from the sender, so they are not.
 *
 * Only when both the payment and notifications about all member source transfers
 * have arrived can settlement proceed.
 *
 * TODO should `records` be stored in a database? (with an index on created_at).
 *
 * @param {Object} config
 * @param {Integer} config.expiry.maxHoldTime seconds
 */
function SettlementQueue (config) {
  this.maxHoldTime = config.expiry.maxHoldTime
  this.records = {}
}

/**
 * Called via POST /notifications (from a ledger)
 *
 * @param {Transfer} transfer a trusted source_transfer
 * @returns {Payment|undefined} the trusted payment
 */
SettlementQueue.prototype.storeTransfer = function (transfer) {
  if (transfer.state !== 'prepared' && transfer.state !== 'executed') {
    delete this.records[transfer.id]
    return
  }

  if (this.records[transfer.id]) {
    this.records[transfer.id].transfer = transfer
    return this._getTruePaymentFromTransfer(transfer.id)
  } else {
    this.records[transfer.id] = makeRecord(transfer, null)
  }
}

/**
 * Store a payment. The source_transfers are not trusted.
 * Called via PUT /payments/:payment_id (from a sender)
 *
 * @param {Payment} payment
 * @returns {Payment|undefined} the trusted payment
 */
SettlementQueue.prototype.storePayment = function (payment) {
  for (let transfer of payment.source_transfers) {
    if (this.records[transfer.id]) {
      this.records[transfer.id].payment = payment
    } else {
      this.records[transfer.id] = makeRecord(null, payment)
    }
  }
  return this._getTruePayment(payment)
}

/**
 * Check the relevance of the transfer.
 *
 * @param {URI} transferID
 * @returns {Boolean}
 */
SettlementQueue.prototype.hasPaymentForTransfer = function (transferID) {
  const record = this.records[transferID]
  return !!(record && record.payment)
}

/**
 * @param {Payment} payment an untrusted payment
 * @returns {Payment|undefined} a trusted payment or undefined
 */
SettlementQueue.prototype._getTruePayment = function (payment) {
  for (let i = 0; i < payment.source_transfers.length; i++) {
    const transferID = payment.source_transfers[i].id
    const record = this.records[transferID]
    if (!record.transfer || !record.payment) return
    payment.source_transfers[i] = record.transfer
  }
  return payment
}

/**
 * @param {URI} transferID a source_transfer ID
 * @returns {Payment|undefined} a trusted payment or undefined
 */
SettlementQueue.prototype._getTruePaymentFromTransfer = function (transferID) {
  const record = this.records[transferID]
  const payment = record && record.payment
  return payment && this._getTruePayment(payment)
}

/**
 * @param {Payment} payment
 */
SettlementQueue.prototype.removePayment = function (payment) {
  for (let transfer of payment.source_transfers) {
    delete this.records[transfer.id]
  }
}

/**
 * Delete records that are no longer useful.
 */
SettlementQueue.prototype.prune = function () {
  const minimumTime = Date.now() - this.maxHoldTime * 1000
  const transferIDs = Object.keys(this.records)
  for (let transferID of transferIDs) {
    const record = this.records[transferID]
    if (record.created_at < minimumTime) {
      delete this.records[transferID]
    }
  }
}

SettlementQueue.prototype.startPruner = function () {
  return setInterval(this.prune.bind(this), 10000)
}

// For testing only
SettlementQueue.prototype._reset = function () { this.records = {} }

/**
 * @param {Transfer|null} transfer
 * @param {Payment|null} payment
 * @returns {Object}
 */
function makeRecord (transfer, payment) {
  return {
    transfer: transfer,
    payment: payment,
    created_at: Date.now()
  }
}

module.exports = SettlementQueue
