'use strict'
const co = require('co')
const API = require('ripple-lib').RippleAPI
const log = require('../../../services/log')('rippledLedger')
const TransferPool = require('./transfer-pool')
const utils = require('./utils')

function TransferAPI (ledger_id, credentials) {
  this.ledger_id = ledger_id
  this.credentials = credentials
  this.client = null
  this.transferPool = new TransferPool()
}

TransferAPI.prototype.connect = function * () {
  if (!this.client) {
    this.client = new API({ servers: [this.ledger_id] })
    yield this.client.connect()
  }
}

TransferAPI.prototype.suspendedPaymentCreate = function * (transfer) {
  yield this.connect()
  let transaction = yield this.client.prepareSuspendedPaymentCreation(
    this.credentials.address,
    makeSuspendedPaymentCreate(transfer))
  transfer.payment_sequence = transaction.instructions.sequence
  yield this._submitTransaction(transaction.txJSON)
  utils.setTransferState(transfer, 'prepared')
  this.transferPool.insert(transfer)
}

TransferAPI.prototype.suspendedPaymentFinish = function * (transfer) {
  yield this.connect()
  let creatorAccount = transfer.debits[0].address
  let transaction = yield this.client.prepareSuspendedPaymentExecution(
    this.credentials.address,
    makeSuspendedPaymentFinish(transfer, creatorAccount))
  yield this._submitTransaction(transaction.txJSON)
}

TransferAPI.prototype.suspendedPaymentCancel = function * (transfer) {
  yield this.connect()
  let transaction = yield this.client.prepareSuspendedPaymentCancellation(
    this.credentials.address,
    makeSuspendedPaymentCancel(transfer, this.credentials.address))
  yield this._submitTransaction(transaction.txJSON)
  this.transferPool.remove(transfer)
}

TransferAPI.prototype._submitTransaction = function * (txJSON) {
  let submitRes = yield this.client.submit(
    this.client.sign(txJSON, this.credentials.secret).signedTransaction)
  let result = submitRes.engineResult
  if (result !== 'tesSUCCESS') {
    throw new Error(submitRes.txJson.TransactionType + ' error: ' + result)
  }
}

// onTransaction*(rippleLibNotification)
TransferAPI.prototype.subscribe = function * (onTransaction) {
  yield this.connect()
  let remote = this.client.remote
  let req = remote.requestSubscribe(['ledger', 'transactions'])
  req.setAccounts([this.credentials.address])

  remote.on('ledger_closed', function (notif) {
    this.transferPool.setTime(timeFromRipple(notif.ledger_time))
  }.bind(this))
  remote.on('transaction', function (notif) {
    co(onTransaction, notif).catch(log.error.bind(log))
  })

  yield new Promise(function (resolve, reject) {
    req.request(function (err) {
      return err ? reject(err) : resolve()
    })
  })
}

function makeSuspendedPaymentCreate (transfer) {
  let debit = transfer.debits[0]
  let credit = transfer.credits[0]
  return {
    source: {
      address: debit.address,
      maxAmount: {
        currency: 'XRP',
        value: debit.amount
      }
    },
    destination: {
      address: credit.address,
      amount: {
        currency: 'XRP',
        value: credit.amount
      }
    },
    allowCancelAfter: (new Date(transfer.expires_at)).getTime(),
    digest: transfer.execution_condition.digest
  }
}

function makeSuspendedPaymentFinish (transfer, creatorAccount) {
  return {
    owner: creatorAccount,
    paymentSequence: transfer.payment_sequence,
    digest: transfer.execution_condition.digest,
    proof: transfer.execution_condition_fulfillment.message,
    method: 1
  }
}

function makeSuspendedPaymentCancel (transfer, creatorAccount) {
  return {
    owner: creatorAccount,
    paymentSequence: transfer.payment_sequence
  }
}

/**
 * (from ripple-lib src/core/utils.js)
 * @param {Number} rpepoch (seconds since 1/1/2000 GMT)
 * @return {Number} ms since unix epoch
 */
function timeFromRipple (rpepoch) {
  return (rpepoch + 0x386D4380) * 1000
}

module.exports = TransferAPI
