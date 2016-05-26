'use strict'
const lodash = require('lodash')
const request = require('co-request')
const uuid = require('uuid4')
const WebSocket = require('ws')
const reconnectCore = require('reconnect-core')
const validator = require('../validate')
const log = require('../../common').log('fiveBellsLedger')
const ExternalError = require('../../errors/external-error')

const backoffMin = 1000
const backoffMax = 30000

// By using a single constant UUID we avoid duplicate subscriptions
// TODO Obviously that is a hack and will need to change eventually
const notificationUuid = uuid()

function FiveBellsLedger (options) {
  this.id = options.ledger_id
  this.credentials = options.credentials
  this.config = options.config
}

FiveBellsLedger.prototype.validateTransfer = function (transfer) {
  validator.validate('TransferTemplate', transfer)
}

// template - {amount}
FiveBellsLedger.prototype.makeFundTemplate = function (template) {
  template.account = this.credentials.account_uri
  return template
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

FiveBellsLedger.prototype.putTransferFulfillment = function * (transferID, executionConditionFulfillment) {
  const fulfillmentRes = yield this._request({
    method: 'put',
    uri: transferID + '/fulfillment',
    body: executionConditionFulfillment,
    json: false
  })
  // TODO check the timestamp the ledger sends back
  // See https://github.com/interledger/five-bells-ledger/issues/149
  if (fulfillmentRes.statusCode === 200 || fulfillmentRes.statusCode === 201) {
    return 'executed'
  } else {
    log.error('Failed to submit fulfillment for transfer: ' + transferID + ' Error: ' + (fulfillmentRes.body ? JSON.stringify(fulfillmentRes.body) : fulfillmentRes.error))
  }
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
  const transferRes = yield request(lodash.defaults(opts, lodash.omitBy({
    auth: credentials.username && credentials.password && {
      user: credentials.username,
      pass: credentials.password
    },
    cert: credentials.cert,
    key: credentials.key,
    ca: credentials.ca,
    json: true
  }, lodash.isUndefined)))
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

FiveBellsLedger.prototype.subscribe = function * (listener) {
  const accountUri = this.credentials.account_uri
  if (this.config.getIn(['features', 'debugAutoFund'])) yield this._autofund()

  const streamUri = accountUri.replace('http', 'ws') + '/transfers'
  log.debug('subscribing to ' + streamUri)
  const auth = this.credentials.password && this.credentials.username &&
                 this.credentials.username + ':' + this.credentials.password
  const options = {
    headers: auth && {
      Authorization: 'Basic ' + new Buffer(auth, 'utf8').toString('base64')
    },
    cert: this.credentials.cert,
    key: this.credentials.key,
    ca: this.credentials.ca
  }

  var reconnect = reconnectCore(function () {
    return new WebSocket(streamUri, lodash.omitBy(options, lodash.isUndefined))
  })

  reconnect({immediate: true}, (ws) => {
    ws.on('open', () => {
      log.info('ws connected to ' + streamUri)
    })
    ws.on('message', (msg) => {
      const notification = JSON.parse(msg)
      log.debug('notify', notification.resource.id)
      try {
        listener(notification.resource, notification.related_resources)
      } catch (err) {
        log.warn('failure while processing notification: ' + err)
      }
    })
    ws.on('close', () => {
      log.info('ws disconnected from ' + streamUri)
    })
  })
  .on('error', function (err) {
    log.warn('ws error on ' + streamUri + ': ' + err)
  })
  .connect()
}

FiveBellsLedger.prototype._autofund = function * () {
  log.info('autofunded account at ' + this.id)
  const admin = this.config.get('admin')
  yield requestRetry({
    method: 'put',
    url: this.credentials.account_uri,
    json: true,
    body: {
      name: this.credentials.username,
      balance: '1500000',
      connector: this.config.getIn(['server', 'base_uri']),
      password: this.credentials.password,
      fingerprint: this.credentials.fingerprint
    }
  }, 'could not create account at ledger ' + this.id, admin)
}

function * requestRetry (opts, errorMessage, credentials) {
  let delay = backoffMin
  while (true) {
    try {
      let res = yield request(lodash.defaults(opts, lodash.omitBy({
        auth: credentials.password && credentials.username && {
          user: credentials.username,
          pass: credentials.password
        },
        cert: credentials.cert,
        key: credentials.key,
        ca: credentials.ca,
        json: true
      }, lodash.isUndefined)))
      return res
    } catch (err) {
      log.warn(errorMessage)
      delay = Math.min(Math.floor(1.5 * delay), backoffMax)
      yield wait(delay)
    }
  }
}

FiveBellsLedger.prototype.unsubscribe = function * () {
  yield requestRetry({
    method: 'delete',
    url: this.id + '/subscriptions/' + notificationUuid
  }, 'could not unsubscribe from ledger ' + this.id, this.credentials)
}

FiveBellsLedger.prototype.checkHealth = function * () {
  log.info('checking health for ' + this.id)
  yield requestRetry({
    method: 'get',
    url: this.id + '/health'
  }, 'could not check health for ledger ' + this.id, this.credentials)
}

function wait (ms) {
  return function (done) {
    setTimeout(done, ms)
  }
}

module.exports = FiveBellsLedger
