'use strict'
const request = require('co-request')
const uuid = require('uuid4')
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

// template - {amount}
FiveBellsLedger.prototype.makeFundTemplate = function (template) {
  template.account = this.credentials.account_uri
  return template
}

FiveBellsLedger.prototype.getState = function (transfer) {
  return request({
    method: 'get',
    uri: transfer.id + '/state',
    json: true
  })
}

FiveBellsLedger.prototype.putTransfer = function * (transfer) {
  // TODO: check before this point that we actually have
  // credentials for the ledgers we're asked to settle between
  let credentials = this.credentials
  let transferReq = yield request({
    method: 'put',
    auth: credentials && {
      user: credentials.username,
      pass: credentials.password
    },
    uri: transfer.id,
    body: transfer,
    json: true
  })
  // TODO for source transfers: handle this so we actually get our money back
  if (transferReq.statusCode >= 400) {
    log.error('remote error while authorizing transfer')
    log.debug(transferReq.body)
    throw new ExternalError('Received an unexpected ' +
      transferReq.body.id + ' while processing transfer.')
  }

  // Update destination_transfer state from the ledger's response
  transfer.state = transferReq.body.state
  if (transfer.state === 'executed' &&
  !transfer.execution_condition_fulfillment) {
    transfer.execution_condition_fulfillment =
      transferReq.body.execution_condition_fulfillment
  }
}

FiveBellsLedger.prototype.subscribe = function * (target_uri) {
  let account_uri = this.credentials.account_uri
  let subscribeRes = yield request_retry({
    method: 'put',
    url: this.id + '/subscriptions/' + notificationUuid,
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

  if (config.features.debugAutoFund) {
    log.info('creating account at ' + this.id)
    yield request_retry({
      method: 'put',
      url: account_uri,
      auth: config.admin,
      json: true,
      body: {
        name: account_uri,
        balance: '1500000',
        identity: config.server.base_uri,
        password: this.credentials.password
      }
    }, 'could not create account at ledger ' + this.id)
  }
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
