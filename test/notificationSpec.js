'use strict'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const _ = require('lodash')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('five-bells-connector')._test.logger
const logHelper = require('./helpers/log')
const sinon = require('sinon')
const jsonSigning = require('five-bells-shared').JSONSigning
const subscriptions = require('../src/models/subscriptions')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const fs = require('fs')
const ledgerPrivateKey = fs.readFileSync('./test/data/ledger1private.pem', 'utf8')

function signNotification (notification) {
  const algorithm = 'CC'
  return jsonSigning.sign(notification, algorithm, ledgerPrivateKey)
}

function invalidlySignNotification (notification) {
  const key = fs.readFileSync('./test/data/ledger2private.pem', 'utf8')
  const algorithm = 'CC'
  return jsonSigning.sign(notification, algorithm, key)
}

const env = _.cloneDeep(process.env)

describe('Notifications', function () {
  logHelper(logger)

  beforeEach(function * () {
    this.clock = sinon.useFakeTimers(START_DATE)

    appHelper.create(this)

    yield subscriptions.subscribePairs(this.config.tradingPairs,
      this.ledgers, this.config, this.routeBuilder)
    yield this.backend.connect(ratesResponse)
    yield this.routeBroadcaster.reloadLocalRoutes()
    yield subscriptions.setupListeners(this.ledgers, this.config, this.routeBuilder)
  })

  afterEach(function * () {
    nock.cleanAll()
    this.clock.restore()
  })

  describe('POST /notifications -- signed', function () {
    beforeEach(function * () {
      process.env.CONNECTOR_NOTIFICATION_VERIFY = 'true'
      process.env.CONNECTOR_NOTIFICATION_KEYS = JSON.stringify({
        'http://eur-ledger.example': 'cc:3:11:Jd1P5DR8KKOp3OfcTfKdolh2IREIdG3LP2WU8gg6pCc:518',
        'http://example.com': 'cc:3:11:VIXEKIp-38aZuievH3I3PyOobH6HW-VD4LP6w-4s3gA:518'
      })
      process.env.CONNECTOR_LEDGERS = JSON.stringify([
        'EUR@http://eur-ledger.example',
        'USD@http://example.com'
      ])
      appHelper.create(this)
      yield this.backend.connect(ratesResponse)
      yield subscriptions.setupListeners(this.ledgers, this.config, this.routeBuilder)

      this.notificationSourceTransferPrepared =
        _.cloneDeep(require('./data/notificationSourceTransferPrepared.json'))
    })

    afterEach(function * () { process.env = _.cloneDeep(env) })

    it('returns 200 if the notification is signed', function * () {
      this.notificationSourceTransferPrepared.resource.state = 'proposed'
      yield this.request()
        .post('/notifications')
        .send(signNotification(this.notificationSourceTransferPrepared))
        .expect(200)
        .end()
    })

    it('returns 422 if the notification has an invalid signature', function * () {
      const notification = this.notificationSourceTransferPrepared
      const signedNotifcation = invalidlySignNotification(notification)
      yield this.request()
        .post('/notifications')
        .send(signedNotifcation)
        .expect(422)
        .end()
    })
  })

  describe('POST /notifications', function () {
    beforeEach(function * () {
      this.paymentOneToOne =
        _.cloneDeep(require('./data/paymentOneToOne.json'))
      this.paymentManyToOne =
        _.cloneDeep(require('./data/paymentManyToOne.json'))
      this.paymentSameExecutionCondition =
        _.cloneDeep(require('./data/paymentSameExecutionCondition.json'))
      this.transferExecutedReceipt = require('./data/transferExecutedFulfillment.json')
      this.notificationNoConditionFulfillment =
        _.cloneDeep(require('./data/notificationNoConditionFulfillment.json'))
      this.notificationWithConditionFulfillment =
        _.cloneDeep(require('./data/notificationWithConditionFulfillment.json'))
      this.notificationSourceTransferPrepared =
        _.cloneDeep(require('./data/notificationSourceTransferPrepared.json'))
      this.notificationDestinationTransferPrepared =
        _.cloneDeep(require('./data/notificationDestinationTransferPrepared.json'))
    })

    afterEach(function * () { process.env = _.cloneDeep(env) })

    it('should return a 400 if the notification does not have an id field', function * () {
      delete this.notificationNoConditionFulfillment.id
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    // TODO: -shared currently accepts relative URIs as valid IRIs - it shouldn't
    it.skip('should return a 400 if the notification has an invalid id field (simple name)', function * () {
      this.notificationNoConditionFulfillment.id =
        'name'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    it.skip('should return a 400 if the notification has an invalid id field (uuid)', function * () {
      this.notificationNoConditionFulfillment.id =
        '96bdd66f-f37a-4be2-a7b0-4a449d78cd33'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    it('returns 200 if the transfer is proposed', function * () {
      this.notificationSourceTransferPrepared.resource.state = 'proposed'
      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })

    it('should return a 200 if the notification has a valid id field (uri)', function * () {
      this.notificationNoConditionFulfillment.id =
        'http://example.com/example/1234-5678/blah?foo=bar&bar=baz'
      // Set the state to 'prepared' so that it doesn't try execute source transfers.
      this.notificationNoConditionFulfillment.resource.state = 'prepared'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(200)
        .end()
    })

    // TODO: -shared currently does not accept IRIs although it should
    it.skip('should return a 422 if the notification has a valid id field (iri)', function * () {
      this.notificationNoConditionFulfillment.id =
        'http://exämple.com/example/1234-5678/blah?fòo=bar&bar=baz'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(422)
        .end()
    })

    it('should return a 400 if the notification does not have an event field', function * () {
      delete this.notificationNoConditionFulfillment.event
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    it('should return a 400 if the notification has an invalid event field', function * () {
      this.notificationNoConditionFulfillment.event = 'hello there'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    it('should return a 400 if the resource field is not a valid transfer', function * () {
      this.notificationNoConditionFulfillment.resource.additional_field =
        'blah'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    it('should return a 200 if the notification is properly formatted', function * () {
      const payment = this.formatId(this.paymentSameExecutionCondition,
        '/payments/')

      nock(payment.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'prepared'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', this.notificationWithConditionFulfillment.related_resources.execution_condition_fulfillment)
        .reply(201, this.notificationWithConditionFulfillment.related_resources.execution_condition_fulfillment)

      yield this.request()
        .post('/notifications')
        .send({
          id: this.notificationSourceTransferPrepared.id,
          event: 'transfer.update',
          resource: _.merge({}, payment.source_transfers[0], {
            credits: [{
              memo: { ilp_header: {
                ledger: payment.destination_transfers[0].ledger,
                amount: payment.destination_transfers[0].credits[0].amount,
                account: payment.destination_transfers[0].credits[0].account
              } }
            }]
          })
        })
        .expect(200)
        .end()

      yield this.request()
        .post('/notifications')
        .send(_.merge({}, this.notificationWithConditionFulfillment, {
          resource: {
            debits: [{
              memo: {
                source_transfer_ledger: payment.source_transfers[0].ledger,
                source_transfer_id: payment.source_transfers[0].id
              }
            }]
          }
        }))
        .end()
    })

    it('should return a 500 if the notification handler throws', function * () {
      const payment = this.formatId(this.paymentSameExecutionCondition,
        '/payments/')

      this.ledgers.getLedger(payment.destination_transfers[0].ledger)._handleNotification =
        function * () { throw new Error() }

      yield this.request()
        .post('/notifications')
        .send(_.merge({}, this.notificationWithConditionFulfillment, {
          resource: {
            debits: [{
              memo: {
                source_transfer_ledger: payment.source_transfers[0].ledger,
                source_transfer_id: payment.source_transfers[0].id
                  .substring(payment.source_transfers[0].id.length - 36)
              }
            }]
          }
        }))
        .expect(500)
        .end()
    })

    it('should not cause server error if source transfer is missing execution_condition', function * () {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')

      nock(payment.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'prepared'
        }))

      const notification = _.cloneDeep(this.notificationSourceTransferPrepared)
      delete notification.resource.execution_condition

      yield this.request()
        .post('/notifications')
        .send(notification)
        .expect(200)
        .end()
    })

    it('should return 200 if the payment is not relevant to the connector', function * () {
      this.ledgers.getLedger(this.notificationSourceTransferPrepared.resource.ledger)
        ._handleNotification = function * () { throw makeError('UnrelatedNotificationError') }

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .expect({
          result: 'ignored',
          ignoreReason: {id: 'UnrelatedNotificationError', message: 'error message'}
        })
        .end()
    })

    it('should return 200 if the rate of the payment is worse than the one currently offered', function * () {
      this.ledgers.getLedger(this.notificationSourceTransferPrepared.resource.ledger)
        ._handleNotification = function * () { throw makeError('UnacceptableRateError') }

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .expect({
          result: 'ignored',
          ignoreReason: {id: 'UnacceptableRateError', message: 'error message'}
        })
        .end()
    })

    it('should return 200 if the payment is from an unknown source ledger', function * () {
      this.ledgers.getLedger(this.notificationSourceTransferPrepared.resource.ledger)
        ._handleNotification = function * () { throw makeError('AssetsNotTradedError') }

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .expect({
          result: 'ignored',
          ignoreReason: {id: 'AssetsNotTradedError', message: 'error message'}
        })
        .end()
    })

    it('should return a 200 if the source transfer is expired', function * () {
      this.ledgers.getLedger(this.notificationSourceTransferPrepared.resource.ledger)
        ._handleNotification = function * () { throw makeError('UnacceptableExpiryError') }

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .expect({
          result: 'ignored',
          ignoreReason: {id: 'UnacceptableExpiryError', message: 'error message'}
        })
        .end()
    })

    it.skip('should get the fulfillment and execute the source transfers when the destination transfer response indicates that it has already been executed', function * () {
      const sourceTransfer = this.notificationSourceTransferPrepared.resource
      const destinationTransfer = this.notificationDestinationTransferPrepared

      const connectorCredentials = this.config.ledgerCredentials[destinationTransfer.ledger]

      nock(destinationTransfer.id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, destinationTransfer, {state: 'executed'}))

      nock(sourceTransfer.id)
        .put('/fulfillment', this.transferExecutedReceipt)
        .reply(201, this.transferExecutedReceipt)
      nock(destinationTransfer.id)
        .get('/fulfillment')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })
  })
})

function makeError (name) {
  const error = new Error('error message')
  error.name = name
  return error
}
