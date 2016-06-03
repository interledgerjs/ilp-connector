'use strict'

const _ = require('lodash')
const co = require('co')
const lodash = require('lodash')
const request = require('co-request')
const ws = require('../services/ws')
const reconnectCore = require('reconnect-core')
const validator = require('../lib/validate')
const log = require('../common').log('fiveBellsLedger')
const ExternalError = require('../errors/external-error')
const UnrelatedNotificationError = require('../errors/unrelated-notification-error')
const EventEmitter2 = require('eventemitter2').EventEmitter2

const backoffMin = 1000
const backoffMax = 30000

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

class FiveBellsLedger extends EventEmitter2 {
  constructor (options) {
    super()

    this.id = options.ledger_id
    this.credentials = options.credentials
    this.config = options.config

    this.connection = null
    this.connected = false
  }

  connect () {
    return co(this._connect.bind(this))
  }

  * _connect () {
    const accountUri = this.credentials.account_uri
    if (this.config.getIn(['features', 'debugAutoFund'])) yield this._autofund()

    if (this.connection) {
      log.warn('already connected, ignoring connection request')
      return Promise.resolve(null)
    }

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

    const reconnect = reconnectCore(function () {
      return new ws.WebSocket(streamUri, lodash.omitBy(options, lodash.isUndefined))
    })

    return new Promise((resolve, reject) => {
      this.connection = reconnect({immediate: true}, (ws) => {
        ws.on('open', () => {
          log.info('ws connected to ' + streamUri)
        })
        ws.on('message', (msg) => {
          const notification = JSON.parse(msg)
          log.debug('notify', notification.resource.id)
          co.wrap(this._handleNotification)
            .call(this, notification.resource, notification.related_resources)
            .then(() => {
              if (this.config.features.debugReplyNotifications) {
                ws.send(JSON.stringify({ result: 'processed' }))
              }
            })
            .catch((err) => {
              log.warn('failure while processing notification: ' + err)
              if (this.config.features.debugReplyNotifications) {
                ws.send(JSON.stringify({
                  result: 'ignored',
                  ignoreReason: {
                    id: err.name,
                    message: err.message
                  }
                }))
              }
            })
        })
        ws.on('close', () => {
          log.info('ws disconnected from ' + streamUri)
        })
      })
      .once('connect', () => resolve(null))
      .on('connect', () => {
        this.connected = true
        this.emit('connect')
      })
      .on('disconnect', () => {
        this.connected = false
        this.emit('disconnect')
      })
      .on('error', function (err) {
        log.warn('ws error on ' + streamUri + ': ' + err)
        reject(err)
      })
      .connect()
    })
  }

  disconnect () {
    if (this.connection) {
      this.connection.disconnect()
      this.connection = null
    }
  }

  isConnected () {
    return this.connected
  }

  getInfo () {
    return co.wrap(this._getInfo).call(this)
  }

  * _getInfo () {
    log.debug('getInfo', this.id)
    function throwErr () {
      throw new ExternalError('Unable to determine ledger precision')
    }

    let res
    try {
      res = yield request(this.id, {json: true})
    } catch (e) {
      if (!res || res.statusCode !== 200) {
        log.debug('getPrecisionAndScale', e)
        throwErr()
      }
    }

    if (!res || res.statusCode !== 200) throwErr()
    if (!res.body.precision || !res.body.scale) throwErr()

    return {
      precision: res.body.precision,
      scale: res.body.scale
    }
  }

  getAccount () {
    return this.credentials.account_uri
  }

  _validateTransfer (transfer) {
    validator.validate('TransferTemplate', transfer)
  }

  getBalance () {
    return co.wrap(this._getBalance).call(this)
  }

  * _getBalance () {
    const creds = this.credentials
    let res
    try {
      res = yield request({
        method: 'get',
        uri: creds.account_uri,
        auth: creds.password && {
          user: creds.username,
          pass: creds.password
        },
        ca: creds.ca,
        cert: creds.cert,
        key: creds.key,
        json: true
      })
    } catch (e) { }
    if (!res || res.statusCode !== 200) {
      throw new ExternalError('Unable to determine current balance')
    }
    return res.body.balance
  }

  getConnectors () {
    return co.wrap(this._getConnectors).call(this)
  }

  * _getConnectors () {
    const res = yield request({
      method: 'GET',
      uri: this.id + '/connectors',
      json: true
    })
    if (res.statusCode !== 200) {
      throw new Error('Unexpected status code: ' + res.statusCode)
    }
    return _.map(res.body, 'connector')
  }

  send (transfer) {
    return co.wrap(this._send).call(this, transfer)
  }

  * _send (transfer) {
    if (transfer.ledger !== this.id) {
      throw new Error('Transfer was sent to the wrong plugin (expected: ' +
        this.id + ', actual: ' + transfer.ledger + ')')
    }

    const fiveBellsTransfer = {
      id: this.id + '/transfers/' + transfer.id,
      ledger: transfer.ledger,
      debits: [{
        account: this.credentials.account_uri,
        amount: transfer.amount,
        authorized: true,
        memo: transfer.noteToSelf
      }],
      credits: [{
        account: transfer.account,
        amount: transfer.amount,
        memo: transfer.data
      }],
      execution_condition: transfer.executionCondition,
      cancellation_condition: transfer.cancellationCondition,
      expires_at: transfer.expiresAt,
      additional_info: transfer.cases ? { cases: transfer.cases } : undefined
    }
    yield this._request({
      method: 'put',
      uri: fiveBellsTransfer.id,
      body: fiveBellsTransfer
    })

    // TODO: If already executed, fetch fulfillment and forward to source

    return null
  }

  fulfillCondition (transferID, conditionFulfillment) {
    return co.wrap(this._fulfillCondition).call(this, transferID, conditionFulfillment)
  }

  * _fulfillCondition (transferID, conditionFulfillment) {
    const fulfillmentRes = yield this._request({
      method: 'put',
      uri: this.id + '/transfers/' + transferID + '/fulfillment',
      body: conditionFulfillment,
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

  * _getTransferFulfillment (transfer) {
    const fulfillmentRes = yield this._request({
      method: 'get',
      uri: transfer.id + '/fulfillment'
    })
    return fulfillmentRes.body
  }

  * _handleNotification (fiveBellsTransfer, relatedResources) {
    if (fiveBellsTransfer.ledger !== this.id) {
      throw new Error('Transfer was received by the wrong plugin (plugin: ' +
        this.id + ', transfer: ' + fiveBellsTransfer.ledger + ')')
    }

    let handled = false
    for (let credit of fiveBellsTransfer.credits) {
      if (credit.account === this.credentials.account_uri) {
        handled = true

        const transfer = lodash.omitBy({
          id: fiveBellsTransfer.id.substring(fiveBellsTransfer.id.length - 36),
          direction: 'incoming',
          ledger: this.id,
          // TODO: What if there are multiple debits?
          account: fiveBellsTransfer.debits[0].account,
          amount: credit.amount,
          data: credit.memo,
          executionCondition: fiveBellsTransfer.execution_condition,
          cancellationCondition: fiveBellsTransfer.cancellation_condition,
          expiresAt: fiveBellsTransfer.expires_at,
          cases: fiveBellsTransfer.additional_info && fiveBellsTransfer.additional_info.cases
            ? fiveBellsTransfer.additional_info.cases
            : undefined
        }, lodash.isUndefined)

        if (fiveBellsTransfer.state === 'prepared' ||
            (fiveBellsTransfer.state === 'executed' && !transfer.executionCondition)) {
          this._validateTransfer(credit.memo.destination_transfer)
          yield this.emitAsync('incoming', transfer)
        }

        if (fiveBellsTransfer.state === 'executed' && relatedResources &&
            relatedResources.execution_condition_fulfillment) {
          yield this.emitAsync('fulfill_execution_condition', transfer,
            relatedResources.execution_condition_fulfillment)
        }

        if (fiveBellsTransfer.state === 'rejected' && relatedResources &&
            relatedResources.cancellation_condition_fulfillment) {
          yield this.emitAsync('fulfill_cancellation_condition', transfer,
            relatedResources.cancellation_condition_fulfillment)
        }
      }
    }

    for (let debit of fiveBellsTransfer.debits) {
      if (debit.account === this.credentials.account_uri) {
        handled = true

        // This connector only launches transfers with one credit, so there
        // should never be more than one credit.
        const credit = fiveBellsTransfer.credits[0]

        const transfer = lodash.omitBy({
          id: fiveBellsTransfer.id.substring(fiveBellsTransfer.id.length - 36),
          direction: 'outgoing',
          ledger: this.id,
          account: credit.account,
          amount: debit.amount,
          data: credit.memo,
          noteToSelf: debit.memo,
          executionCondition: fiveBellsTransfer.execution_condition,
          cancellationCondition: fiveBellsTransfer.cancellation_condition,
          expiresAt: fiveBellsTransfer.expires_at,
          cases: fiveBellsTransfer.additional_info && fiveBellsTransfer.additional_info.cases
            ? fiveBellsTransfer.additional_info.cases
            : undefined
        }, lodash.isUndefined)

        if (fiveBellsTransfer.state === 'executed' &&
            relatedResources.execution_condition_fulfillment) {
          yield this.emitAsync('fulfill_execution_condition', transfer,
            relatedResources.execution_condition_fulfillment)
        }

        if (fiveBellsTransfer.state === 'rejected' &&
            relatedResources.cancellation_condition_fulfillment) {
          yield this.emitAsync('fulfill_cancellation_condition', transfer,
            relatedResources.cancellation_condition_fulfillment)
        }
      }

      if (!handled) {
        throw new UnrelatedNotificationError('Notification does not seem related to connector')
      }
    }
  }

  * _request (opts) {
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

  * _autofund () {
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
}

function wait (ms) {
  return function (done) {
    setTimeout(done, ms)
  }
}

module.exports = FiveBellsLedger
