'use strict'
const _ = require('lodash')
const co = require('co')
const Condition = require('@ripple/five-bells-condition').Condition
const UnmetConditionError = require('@ripple/five-bells-shared/errors/unmet-condition-error')
const TransferAPI = require('./transfer-api')
const Subscriber = require('./subscriber')
const log = require('../../../services/log')('rippledLedger')
const utils = require('./utils')

function RippledLedger (ledger_id, credentials) {
  this.id = ledger_id
  this.client = new TransferAPI(ledger_id, credentials)
  this.credentials = credentials // {address, secret}

  this.client.transferPool.on('expire', function (transfers) {
    co(this._rejectTransfers.bind(this), transfers).catch(onExpireError)
  }.bind(this))
}

// template - {amount}
RippledLedger.prototype.makeFundTemplate = function (template) {
  template.address = this.credentials.address
  return template
}

RippledLedger.prototype.getState = function (transfer) {
  throw new Error('RippledLedger#getState is not implemented')
}

// pre-prepared -> place hold on debited funds -> prepared
RippledLedger.prototype.putTransfer = function * (transfer) {
  if (transfer.debits.length !== 1) {
    throw new Error('XRP transfers must have exactly 1 debit')
  }
  if (transfer.credits.length !== 1) {
    throw new Error('XRP transfers must have exactly 1 credit')
  }

  if (transfer.state === undefined) {
    // do nothing: propose is a noop
    transfer.state = 'proposed'
  }
  if (transfer.state === 'proposed' && isAuthorized(transfer)) {
    yield this.client.suspendedPaymentCreate(transfer)
  }
  if (transfer.state === 'prepared') {
    if (transfer.execution_condition &&
      transfer.execution_condition_fulfillment) {
      let isValidFulfillment = Condition.testFulfillment(transfer.execution_condition,
        transfer.execution_condition_fulfillment)
      if (!isValidFulfillment) {
        throw new UnmetConditionError('Invalid ConditionFulfillment')
      }
      yield this.client.suspendedPaymentFinish(transfer)
    } else if (!transfer.execution_condition) {
      yield this.client.suspendedPaymentFinish(transfer)
    }
  }
}

// options - {target_uri, event, uuid}
RippledLedger.prototype.subscribe = function * (options) {
  let subscriber = new Subscriber(this.client, options)
  yield this.client.subscribe(subscriber.onTransaction.bind(subscriber))
}

// /////////////////////////////////////////////////////////////////////////////
// Expiration
// /////////////////////////////////////////////////////////////////////////////

RippledLedger.prototype._rejectTransfers = function * (transfers) {
  yield transfers.map(this._rejectTransfer, this)
}

RippledLedger.prototype._rejectTransfer = function * (transfer) {
  utils.setTransferState(transfer, 'rejected')
  yield this.client.suspendedPaymentCancel(transfer)
}

function onExpireError (err) {
  log.warn('expire error', err.stack)
}

function isAuthorized (transfer) {
  return _.every(transfer.debits, 'authorized')
}

module.exports = RippledLedger
