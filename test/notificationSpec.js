'use strict'
const _ = require('lodash')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const moment = require('moment')
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('five-bells-connector')._test.logger
const logHelper = require('five-bells-shared/testHelpers/log')
const expect = require('chai').expect
const assert = require('chai').assert
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
    nock('http://usd-ledger.example').get('/')
      .reply(200, {
        precision: 10,
        scale: 4
      })

    nock('http://eur-ledger.example').get('/')
      .reply(200, {
        precision: 10,
        scale: 4
      })

    yield this.backend.connect(ratesResponse)
    yield this.routeBroadcaster.reloadLocalRoutes()
    yield subscriptions.setupListeners(this.ledgers, this.config)
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
      yield subscriptions.setupListeners(this.ledgers, this.config)

      this.clock = sinon.useFakeTimers(START_DATE)
      this.notificationSourceTransferPrepared =
        _.cloneDeep(require('./data/notificationSourceTransferPrepared.json'))
    })

    afterEach(function * () {
      nock.cleanAll()
      this.clock.restore()
      process.env = _.cloneDeep(env)
    })

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
      process.env.CONNECTOR_LEDGERS = JSON.stringify([
        'EUR@http://eur-ledger.example',
        'USD@http://example.com'
      ])
      appHelper.create(this)
      yield this.backend.connect(ratesResponse)
      yield subscriptions.setupListeners(this.ledgers, this.config)

      this.clock = sinon.useFakeTimers(START_DATE)

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
      this.notificationSourceTransferAtomic =
        _.cloneDeep(require('./data/notificationSourceTransferAtomic.json'))
      this.notificationSourceTransferAtomic_TwoCases =
        _.cloneDeep(require('./data/notificationSourceTransferAtomic_TwoCases.json'))
    })

    afterEach(function * () {
      nock.cleanAll()
      this.clock.restore()
      process.env = _.cloneDeep(env)
    })

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

    it('should return a 400 if the notification is not related to a payment the connector has participated in', function * () {
      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
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
              memo: {destination_transfer: payment.destination_transfers[0]}
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

    it('should return a 502 if the upstream ledger returns 5XX', function * () {
      const payment = this.formatId(this.paymentSameExecutionCondition,
        '/payments/')

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', this.notificationWithConditionFulfillment.related_resources.execution_condition_fulfillment)
        .reply(500)

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
        .expect(502)
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

    it('should submit the source transfer corresponding to the destination transfer it is notified about if the execution conditions are the same', function * () {
      const payment = this.formatId(this.paymentSameExecutionCondition,
        '/payments/')

      nock(payment.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'prepared'
        }))

      let sourceTransferExecuted = nock(payment.source_transfers[0].id)
        .put('/fulfillment',
          this.notificationWithConditionFulfillment
            .resource.execution_condition_fulfillment)
        .reply(201, _.assign({}, payment.source_transfers[0], {
          state: 'executed'
        }))

      yield this.request()
        .post('/notifications')
        .send({
          id: this.notificationSourceTransferPrepared.id,
          event: 'transfer.update',
          resource: _.merge({}, payment.source_transfers[0], {
            credits: [{
              memo: {destination_transfer: payment.destination_transfers[0]}
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
                  .substring(payment.source_transfers[0].id.length - 36)
              }
            }]
          }
        }))
        .expect(200)
        .end()

      // Throw an error if this nock hasn't been executed
      sourceTransferExecuted.done()
    })

    it('should return 200 if the payment is not relevant to the connector', function * () {
      this.notificationSourceTransferPrepared
        .resource.credits[0].account = 'http://usd-ledger.example/accounts/mary'

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .expect({
          result: 'ignored',
          ignoreReason: {
            id: 'UnrelatedNotificationError',
            message: 'Notification does not seem related to connector'
          }
        })
        .end()
    })

    it('should return 200 if the rate of the payment is worse than the one currently offered', function * () {
      this.notificationSourceTransferPrepared
        .resource.credits[0].amount = '1.00'

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .expect({
          result: 'ignored',
          ignoreReason: {
            id: 'UnacceptableRateError',
            message: 'Payment rate does not match the rate currently offered'
          }
        })
        .end()
    })

    it('should return 200 if the payment is from an unknown source ledger', function * () {
      this.notificationSourceTransferPrepared
        .resource.ledger = 'http://abc-ledger.example/ABC'

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .expect({
          result: 'ignored',
          ignoreReason: {
            id: 'AssetsNotTradedError',
            message: 'Unexpected fulfillment from unknown source ledger: http://abc-ledger.example/ABC'
          }
        })
        .end()
    })

    it('should return 200 if the payment is to an unknown destination ledger', function * () {
      this.notificationSourceTransferPrepared
        .resource.credits[0].memo
        .destination_transfer.ledger = 'http://xyz-ledger.example/XYZ'

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .expect({
          result: 'ignored',
          ignoreReason: {
            id: 'AssetsNotTradedError',
            message: 'This connector does not support the given asset pair'
          }
        })
        .end()
    })

    it('returns 400 if the source transfer\'s destination_transfer isn\'t a Transfer', function * () {
      this.notificationSourceTransferPrepared
        .resource.credits[0].memo
        .destination_transfer.debits = []

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidBodyError')
          expect(res.body.message).to.equal('TransferTemplate schema validation error: Array is too short (0), minimum 1')
        })
        .end()
    })

    it('should return a 200 if the source transfer is expired', function * () {
      this.notificationSourceTransferPrepared.resource.expires_at =
        moment(START_DATE - 1).toISOString()

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .expect({
          result: 'ignored',
          ignoreReason: {
            id: 'UnacceptableExpiryError',
            message: 'Transfer has already expired'
          }
        })
        .end()
    })

    it('should return a 200 if the source transfer expires so soon we cannot create a destination transfer with a sufficient large expiry difference', function * () {
      this.notificationSourceTransferPrepared.resource.expires_at =
        moment(START_DATE + 999).toISOString()

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .expect({
          result: 'ignored',
          ignoreReason: {
            id: 'UnacceptableExpiryError',
            message: 'Not enough time to send payment'
          }
        })
        .end()
    })

    it('should return a 200 for a new payment even if the connector is also the payee of the destination transfer', function * () {
      const sourceTransfer = this.notificationSourceTransferPrepared.resource
      const destinationTransfer = sourceTransfer.credits[0].memo.destination_transfer
      destinationTransfer.credits = destinationTransfer.debits

      const connectorCredentials =
        this.config.ledgerCredentials[destinationTransfer.ledger]

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
      yield this.request()
        .post('/notifications')
        .send({
          id: 'http://eur-ledger.example/subscriptions/52a42d6f-8d9c-4c05-b31c-cccc8bbdb31d',
          event: 'transfer.update',
          resource: destinationTransfer
        })
        .expect(200)
    })

    it('should return a 200 for a new payment even if the connector is also the payer of the source transfer', function * () {
      const sourceTransfer = this.notificationSourceTransferPrepared.resource
      const destinationTransfer = sourceTransfer.credits[0].memo.destination_transfer
      sourceTransfer.debits = sourceTransfer.credits

      const connectorCredentials = this.config.ledgerCredentials[destinationTransfer.ledger]

      nock(destinationTransfer.id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, destinationTransfer, {
          state: 'executed'
        }))

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
      yield this.request()
        .post('/notifications')
        .send({
          id: 'http://eur-ledger.example/subscriptions/52a42d6f-8d9c-4c05-b31c-cccc8bbdb31d',
          event: 'transfer.update',
          resource: destinationTransfer
        })
        .expect(200)
    })

    it('should get the fulfillment and execute the source transfers when the destination transfer response indicates that it has already been executed', function * () {
      const sourceTransfer = this.notificationSourceTransferPrepared.resource
      const destinationTransfer = sourceTransfer.credits[0].memo.destination_transfer

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

    it('should execute a payment where its account is not the only credit in the source transfer', function * () {
      const sourceTransfer = this.notificationSourceTransferPrepared.resource
      const destinationTransfer = sourceTransfer.credits[0].memo.destination_transfer

      sourceTransfer.debits[0].amount = '21.07'
      sourceTransfer.credits.unshift({
        account: 'http://usd-ledger.example/accounts/mary',
        amount: '20'
      })

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

    it('should execute a payment where there are multiple debits from its account in the destination transfer', function * () {
      // Note there is no good reason why this should happen but we should
      // be able to handle it appropriately anyway

      const sourceTransfer = this.notificationSourceTransferPrepared.resource
      const destinationTransfer = sourceTransfer.credits[0].memo.destination_transfer

      destinationTransfer.debits[0].amount = '0.60'
      destinationTransfer.debits.push({
        account: 'http://eur-ledger.example/accounts/mark',
        amount: '0.40'
      })

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

    it('should execute a payment where there are multiple credits in the destination transfer', function * () {
      const sourceTransfer = this.notificationSourceTransferPrepared.resource
      const destinationTransfer = sourceTransfer.credits[0].memo.destination_transfer

      destinationTransfer.credits[0].amount = '0.60'
      destinationTransfer.credits.push({
        account: 'http://usd-ledger.example/accounts/timothy',
        amount: '0.40'
      })

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

    it('should only add authorization to the destination transfer debits from the connector\'s account', function * () {
      const sourceTransfer = this.notificationSourceTransferPrepared.resource
      const destinationTransfer = sourceTransfer.credits[0].memo.destination_transfer

      destinationTransfer.debits.unshift({
        amount: '10',
        account: 'http://eur-ledger.example/accounts/other'
      })
      destinationTransfer.credits.unshift({
        amount: '10',
        account: 'http://eur-ledger.example/accounts/jane'
      })

      nock(destinationTransfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      const connectorCredentials = this.config.ledgerCredentials[destinationTransfer.ledger]
      const debitMemo = {
        source_transfer_ledger: sourceTransfer.ledger,
        source_transfer_id: sourceTransfer.id
      }
      const authorizedDestinationTransfer = _.merge({}, destinationTransfer, {
        debits: [
          {memo: debitMemo},
          {memo: debitMemo, authorized: true}
        ]
      })
      nock(destinationTransfer.id)
        .put('', authorizedDestinationTransfer)
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, authorizedDestinationTransfer)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })

    it('should execute a payment where the source transfer\'s expires_at date has passed if the transfer was executed before it expired', function * () {
      const sourceTransfer = this.notificationSourceTransferPrepared.resource
      const destinationTransfer = sourceTransfer.credits[0].memo.destination_transfer

      sourceTransfer.expires_at = moment(START_DATE - 1).toISOString()
      sourceTransfer.state = 'executed'

      const connectorCredentials = this.config.ledgerCredentials[destinationTransfer.ledger]
      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      nock(destinationTransfer.id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, destinationTransfer, {state: 'executed'}))

      nock(sourceTransfer.id)
        .put('/fulfillment', fulfillment)
        .reply(200, fulfillment)

      nock(destinationTransfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })

    describe('atomic mode: one case', function () {
      beforeEach(function () {
        this.source_transfer = this.notificationSourceTransferAtomic.resource
        this.destination_transfer = this.source_transfer.credits[0].memo.destination_transfer
      })

      it('should check the expiry on a cancellation condition: too long', function * () {
        const caseID = this.destination_transfer.additional_info.cases[0]
        nock(caseID)
          .get('')
          .reply(200, { expires_at: future(15000) })

        yield this.request()
          .post('/notifications')
          .send(this.notificationSourceTransferAtomic)
          .expect(200)
          .end()
      })

      it('should check the expiry on a cancellation condition: already expired', function * () {
        const caseID = this.destination_transfer.additional_info.cases[0]
        nock(caseID)
          .get('')
          .reply(200, { expires_at: future(-15000) })

        yield this.request()
          .post('/notifications')
          .send(this.notificationSourceTransferAtomic)
          .expect(200)
          .end()
      })

      it('should check the expiry on a cancellation condition: missing expiry', function * () {
        const caseID = this.destination_transfer.additional_info.cases[0]
        nock(caseID)
          .get('')
          .reply(200, {})

        yield this.request()
          .post('/notifications')
          .send(this.notificationSourceTransferAtomic)
          .expect(200)
          .end()
      })
    })

    describe('atomic mode: two cases', function () {
      beforeEach(function () {
        this.source_transfer = this.notificationSourceTransferAtomic_TwoCases.resource
        this.destination_transfer = this.source_transfer.credits[0].memo.destination_transfer
      })

      it('should check the expiry on a cancellation condition: different expiries', function * () {
        const caseID1 = this.destination_transfer.additional_info.cases[0]
        const caseID2 = this.destination_transfer.additional_info.cases[1]
        nock(caseID1).get('').reply(200, {expires_at: future(5000)})
        nock(caseID2).get('').reply(200, {expires_at: future(6000)})

        yield this.request()
          .post('/notifications')
          .send(this.notificationSourceTransferAtomic_TwoCases)
          .expect(200)
          .end()
      })

      it('should check the expiry on a cancellation condition: same expiries', function * () {
        const caseID1 = this.destination_transfer.additional_info.cases[0]
        const caseID2 = this.destination_transfer.additional_info.cases[1]
        const authorizedDestinationTransfer = _.merge({}, this.destination_transfer, {
          debits: [{authorized: true}]
        })
        const expiresAt = future(5000)
        nock(caseID1).get('').reply(200, {expires_at: expiresAt})
        nock(caseID2).get('').reply(200, {expires_at: expiresAt})

        nock(authorizedDestinationTransfer.id)
          .put('', (body) => {
            assert.deepEqual(body, authorizedDestinationTransfer)
            return true
          })
          .reply(201, authorizedDestinationTransfer)

        yield this.request()
          .post('/notifications')
          .send(this.notificationSourceTransferAtomic_TwoCases)
          .expect(200)
          .end()
      })
    })
  })
})

function future (diff) {
  return (new Date(START_DATE + diff)).toISOString()
}
