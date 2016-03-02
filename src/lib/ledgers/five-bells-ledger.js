'use strict'
const lodash = require('lodash')
const request = require('co-request')
const uuid = require('uuid4')
const validate = require('five-bells-shared/services/validate')
const config = require('../../services/config')
const log = require('../../services/log')('fiveBellsLedger')
const ExternalError = require('../../errors/external-error')

const backoffMin = 1000
const backoffMax = 30000

// By using a single constant UUID we avoid duplicate subscriptions
// TODO Obviously that is a hack and will need to change eventually
const notificationUuid = uuid()

function FiveBellsLedger (options) {
  this.id = options.ledger_id
  this.credentials = options.credentials
}

FiveBellsLedger.validateTransfer = function (transfer) {
  return validate('TransferTemplate', transfer)
}

// template - {amount}
FiveBellsLedger.prototype.makeFundTemplate = function (template) {
  template.account = this.credentials.account_uri
  return template
}

FiveBellsLedger.prototype.getState = function * (transfer) {
  const stateRes = yield this._request({
    method: 'get',
    uri: transfer.id + '/state',
    json: true
  })
  return stateRes.body
}

FiveBellsLedger.prototype.putTransfer = function * (transfer) {
  const transferRes = yield this._request({
    method: 'put',
    uri: transfer.id,
    body: transfer
  })
  const updatedTransfer = transferRes.body
  updateTransfer(transfer, updatedTransfer)
}

FiveBellsLedger.prototype.putTransferFulfillment = function * (transfer, execution_condition_fulfillment) {
  const fulfillmentRes = yield this._request({
    method: 'put',
    uri: transfer.id + '/fulfillment',
    body: execution_condition_fulfillment
  })
  // TODO check the timestamp the ledger sends back
  // See https://github.com/interledger/five-bells-ledger/issues/149
  if (fulfillmentRes.statusCode === 200 || fulfillmentRes.statusCode === 201) {
    transfer.state = 'executed'
  } else {
    log.error('Failed to submit fulfillment for transfer: ' + transfer.id + ' Error: ' + (fulfillmentRes.body ? JSON.stringify(fulfillmentRes.body) : fulfillmentRes.error))
  }
  return fulfillmentRes.body
}

FiveBellsLedger.prototype.getTransferFulfillment = function * (transfer) {
  const fulfillmentRes = yield this._request({
    method: 'get',
    uri: transfer.id + '/fulfillment'
  })
  return fulfillmentRes.body
}

FiveBellsLedger.prototype._request = function * (opts) {
  // TODO: check before this point that we actually have
  // credentials for the ledgers we're asked to settle between
  const credentials = this.credentials
  const transferRes = yield request(lodash.defaults(opts, {
    auth: credentials && {
      user: credentials.username,
      pass: credentials.password
    },
    cert: credentials.cert,
    key: credentials.key,
    ca: credentials.ca,
    json: true
  }))
  // TODO for source transfers: handle this so we actually get our money back
  if (transferRes.statusCode >= 400) {
    throw new ExternalError('Remote error: status=' + transferRes.statusCode + ' body=' + transferRes.body)
  }
  return transferRes
}

// Update destination_transfer state from the ledger's response
function updateTransfer (transfer, updatedTransfer) {
  transfer.state = updatedTransfer.state
  if (transfer.state === 'executed' &&
  !transfer.execution_condition_fulfillment) {
    transfer.execution_condition_fulfillment =
      updatedTransfer.execution_condition_fulfillment
  }
}

FiveBellsLedger.prototype.subscribe = function * (target_uri) {
  let account_uri = this.credentials.account_uri
  if (config.getIn(['features', 'debugAutoFund'])) yield this._autofund()
  let subscribeRes = yield request_retry({
    method: 'put',
    url: this.id + '/subscriptions/' + notificationUuid,
    auth: {
      user: this.credentials.username,
      pass: this.credentials.password
    },
    json: true,
    body: {
      owner: account_uri,
      event: 'transfer.update',
      target: target_uri,
      subject: account_uri
    }
  }, 'could not subscribe to ledger ' + this.id)
  if (subscribeRes.statusCode >= 400) {
    throw new Error('subscribe unexpected status code: ' + subscribeRes.statusCode)
  }
}

FiveBellsLedger.prototype._autofund = function * () {
  log.info('autofunded account at ' + this.id)
  const admin = config.get('admin').toJS()
  yield request_retry({
    method: 'put',
    url: this.credentials.account_uri,
    auth: admin.pass && {
      user: admin.user,
      pass: admin.pass
    },
    json: true,
    body: {
      name: this.credentials.username,
      balance: '1500000',
      connector: config.getIn(['server', 'base_uri']),
      password: this.credentials.password,
      fingerprint: this.credentials.fingerprint
    },
    cert: admin.cert,
    ca: admin.ca,
    key: admin.key
  }, 'could not create account at ledger ' + this.id)
}

function * request_retry (opts, error_msg) {
  let delay = backoffMin
  while (true) {
    try {
      let res = yield request(opts)
      return res
    } catch (err) {
      log.warn(error_msg)
      delay = Math.min(Math.floor(1.5 * delay), backoffMax)
      yield wait(delay)
    }
  }
}

FiveBellsLedger.prototype.unsubscribe = function * () {
  yield request({
    method: 'delete',
    url: this.id + '/subscriptions/' + notificationUuid
  })
}

function wait (ms) {
  return function (done) {
    setTimeout(done, ms)
  }
}

module.exports = FiveBellsLedger
