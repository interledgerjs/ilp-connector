'use strict'
const request = require('co-request')
const config = require('../../services/config')
const log = require('../../services/log')('fiveBellsLedger')
const ExternalError = require('../../errors/external-error')

const backoffMin = 1000
const backoffMax = 30000

function FiveBellsLedger (ledger_id, credentials) {
  this.id = ledger_id
  this.credentials = credentials
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

// options - {target_uri, event, uuid}
FiveBellsLedger.prototype.subscribe = function * (options) {
  let account_uri = this.credentials.account_uri
  yield request_retry({
    method: 'put',
    url: this.id + '/subscriptions/' + options.uuid,
    json: true,
    body: {
      owner: account_uri,
      event: options.event,
      target: options.target_uri
    }
  }, 'could not subscribe to ledger ' + this.id)

  if (config.features.debugAutoFund) {
    log.info('creating account at ' + this.id)
    yield request_retry({
      method: 'put',
      url: account_uri,
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
      yield request(opts)
      return
    } catch (err) {
      log.warn(error_msg)
      delay = Math.min(Math.floor(1.5 * delay), backoffMax)
      yield wait(delay)
    }
  }
}

FiveBellsLedger.prototype.unsubscribe = function * (uuid) {
  yield request({
    method: 'delete',
    url: this.id + '/subscriptions/' + uuid
  })
}

function wait (ms) {
  return function (done) {
    setTimeout(done, ms)
  }
}

module.exports = FiveBellsLedger
