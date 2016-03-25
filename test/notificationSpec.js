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
const sinon = require('sinon')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

describe('Notifications', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)
    yield this.backend.connect(ratesResponse)

    this.clock = sinon.useFakeTimers(START_DATE)

    this.paymentOneToOne =
      _.cloneDeep(require('./data/paymentOneToOne.json'))
    this.paymentManyToOne =
      _.cloneDeep(require('./data/paymentManyToOne.json'))
    this.paymentSameExecutionCondition =
      _.cloneDeep(require('./data/paymentSameExecutionCondition.json'))
    this.transferProposedReceipt =
      _.cloneDeep(require('./data/transferStateProposed.json'))
    this.transferPreparedReceipt =
      _.cloneDeep(require('./data/transferStatePrepared.json'))
    this.transferExecutedReceipt =
      _.cloneDeep(require('./data/transferStateExecuted.json'))
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
    expect(nock.pendingMocks()).to.deep.equal([])
    nock.cleanAll()
    this.clock.restore()
  })

  describe('POST /notifications', function () {
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

    it('should submit the source transfer corresponding to the destination transfer it is notified about if its execution condition is the destination transfer', function * () {
      const payment = this.formatId(this.paymentOneToOne,
        '/payments/')

      nock(payment.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'prepared'
        }))

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      let sourceTransferExecuted = nock(payment.source_transfers[0].id)
        .put('/fulfillment', {
          type: 'ed25519-sha512',
          signature: this.transferExecutedReceipt.signature
        })
        .reply(201, _.assign({}, payment.source_transfers[0], {
          state: 'executed'
        }))

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
      yield this.request()
        .post('/notifications')
        .send(_.merge({}, this.notificationNoConditionFulfillment, {
          resource: {
            debits: [{
              memo: {
                source_transfer_ledger: payment.source_transfers[0].ledger,
                source_transfer_id: payment.source_transfers[0].id
              }
            }]
          }
        }))
        .expect(200)
        .end()

      // Throw an error if this nock hasn't been executed
      sourceTransferExecuted.done()
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
              }
            }]
          }
        }))
        .expect(200)
        .end()

      // Throw an error if this nock hasn't been executed
      sourceTransferExecuted.done()
    })

    it('should return a 422 if the two transfer conditions do not match and the source transfer one does not have the public key of the destination ledger', function * () {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')

      this.notificationSourceTransferPrepared
        .resource.execution_condition.public_key =
          'Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg='

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableConditionsError')
          expect(res.body.message).to.equal('Source transfer execution ' +
            'condition public key must match the destination ledger\'s.')
        })
        .end()
    })

    it.skip('should return a 422 if the two transfer conditions do not ' +
      'match and the source transfer one does not have the same algorithm the ' +
      'destination ledger uses')

    it('should return a 422 if the payment does not include the connector in the source transfer credits', function * () {
      this.notificationSourceTransferPrepared
        .resource.credits[0].account = 'http://usd-ledger.example/accounts/mary'

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnrelatedNotificationError')
          expect(res.body.message).to.equal('Notification does not match a payment we have a record of or the corresponding source transfers may already have been executed')
        })
        .end()
    })

    it('should return a 422 if the payment does not include the connector in the destination transfer debits', function * () {
      this.notificationSourceTransferPrepared
        .resource.credits[0].memo.destination_transfer
        .debits[0].account = 'http://usd-ledger.example/accounts/mary'

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('NoRelatedDestinationDebitError')
          expect(res.body.message).to.equal('Connector\'s account must be ' +
            'debited in all destination transfers to provide payment')
        })
        .end()
    })

    it('should return a 422 if the rate of the payment is worse than the one currently offered', function * () {
      this.notificationSourceTransferPrepared
        .resource.credits[0].amount = '1.00'

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableRateError')
          expect(res.body.message).to.equal('Payment rate does not match ' +
            'the rate currently offered')
        })
        .end()
    })

    it('should return a 422 if the payment includes assets this connector does not offer rates between', function * () {
      this.notificationSourceTransferPrepared
        .resource.ledger = 'http://abc-ledger.example/ABC'
      this.notificationSourceTransferPrepared
        .resource.credits[0].memo
        .destination_transfer.ledger = 'http://xyz-ledger.example/XYZ'

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('AssetsNotTradedError')
          expect(res.body.message).to.equal('This connector does not support ' +
            'the given asset pair')
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
        .end()
    })

    it('should return a 200 if any of the destination transfers is expired', function * () {
      this.notificationSourceTransferPrepared
        .resource.credits[0].memo
        .destination_transfer.expires_at = moment(START_DATE - 1).toISOString()

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })

    it('should return a 200 if a destination transfer has an execution_condition but no expiry', function * () {
      const destination_transfer = this.notificationSourceTransferPrepared
        .resource.credits[0].memo.destination_transfer
      delete destination_transfer.expires_at
      destination_transfer.execution_condition =
        this.notificationSourceTransferPrepared.resource.execution_condition

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })

    it('should return a 200 if any of the destination transfers expires too far in the future (causing the connector to hold money for too long)', function * () {
      const destination_transfer = this.notificationSourceTransferPrepared
        .resource.credits[0].memo.destination_transfer
      destination_transfer.expires_at = moment(START_DATE + 10001).toISOString()
      destination_transfer.execution_condition =
        this.notificationSourceTransferPrepared.resource.execution_condition

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })

    it('should return a 200 if the source transfer expires too soon after the destination transfer (we may not be able to execute the source transfer in time)', function * () {
      const destination_transfer = this.notificationSourceTransferPrepared
        .resource.credits[0].memo.destination_transfer
      destination_transfer.expires_at =
        this.notificationSourceTransferPrepared.resource.expires_at
      destination_transfer.execution_condition =
        this.notificationSourceTransferPrepared.resource.execution_condition

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })

    it('should return a 200 if the source transfer\'s execution condition is the execution of the destination transfer but the destination transfer expires too soon', function * () {
      this.notificationSourceTransferPrepared.resource.credits[0].memo
        .destination_transfer.expires_at = moment(START_DATE + 999).toISOString()

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })

    it('should return a 200 if the source transfer\'s execution condition is the execution of the destination transfer but the source transfer expires too soon (we may not be able to execute the source transfer in time)', function * () {
      this.notificationSourceTransferPrepared.resource.expires_at =
        moment(START_DATE + 1999).toISOString()

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })

    it('should return a 200 for a new payment even if the connector is also the payee of the destination transfer', function * () {
      const source_transfer = this.notificationSourceTransferPrepared.resource
      const destination_transfer = source_transfer.credits[0].memo.destination_transfer
      destination_transfer.credits = destination_transfer.debits

      const connectorCredentials =
        this.config.ledgerCredentials[destination_transfer.ledger]

      nock(destination_transfer.id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, destination_transfer, {state: 'executed'}))

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      nock(source_transfer.id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)
      nock(destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
      nock(destination_transfer.id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
      yield this.request()
        .post('/notifications')
        .send({
          id: 'http://eur-ledger.example/EUR/subscriptions/52a42d6f-8d9c-4c05-b31c-cccc8bbdb31d',
          event: 'transfer.update',
          resource: destination_transfer
        })
        .expect(200)
    })

    it('should return a 200 for a new payment even if the connector is also the payer of the source transfer', function * () {
      const source_transfer = this.notificationSourceTransferPrepared.resource
      const destination_transfer = source_transfer.credits[0].memo.destination_transfer
      source_transfer.debits = source_transfer.credits

      const connectorCredentials = this.config.ledgerCredentials[destination_transfer.ledger]

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      nock(destination_transfer.id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, destination_transfer, {
          state: 'executed'
        }))

      nock(source_transfer.id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)
      nock(destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
      nock(destination_transfer.id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
      yield this.request()
        .post('/notifications')
        .send({
          id: 'http://eur-ledger.example/EUR/subscriptions/52a42d6f-8d9c-4c05-b31c-cccc8bbdb31d',
          event: 'transfer.update',
          resource: destination_transfer
        })
        .expect(200)
    })

    it('should get the fulfillment and execute the source transfers when the destination transfer response indicates that it has already been executed', function * () {
      const source_transfer = this.notificationSourceTransferPrepared.resource
      const destination_transfer = source_transfer.credits[0].memo.destination_transfer

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      const connectorCredentials = this.config.ledgerCredentials[destination_transfer.ledger]

      nock(destination_transfer.id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, destination_transfer, {state: 'executed'}))

      nock(source_transfer.id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)
      nock(destination_transfer.id)
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

    it('should execute a payment where its account is not the only credit in the source transfer', function * () {
      const source_transfer = this.notificationSourceTransferPrepared.resource
      const destination_transfer = source_transfer.credits[0].memo.destination_transfer

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      source_transfer.debits[0].amount = '21.07'
      source_transfer.credits.unshift({
        account: 'http://usd-ledger.example/accounts/mary',
        amount: '20'
      })

      const connectorCredentials = this.config.ledgerCredentials[destination_transfer.ledger]

      nock(destination_transfer.id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, destination_transfer, {state: 'executed'}))

      nock(source_transfer.id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)
      nock(destination_transfer.id)
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

    it('should execute a payment where there are multiple debits from its account in the destination transfer', function * () {
      // Note there is no good reason why this should happen but we should
      // be able to handle it appropriately anyway

      const source_transfer = this.notificationSourceTransferPrepared.resource
      const destination_transfer = source_transfer.credits[0].memo.destination_transfer

      destination_transfer.debits[0].amount = '0.60'
      destination_transfer.debits.push({
        account: 'http://eur-ledger.example/accounts/mark',
        amount: '0.40'
      })

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      const connectorCredentials = this.config.ledgerCredentials[destination_transfer.ledger]

      nock(destination_transfer.id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, destination_transfer, {state: 'executed'}))

      nock(source_transfer.id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)
      nock(destination_transfer.id)
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

    it('should execute a payment where there are multiple credits in the destination transfer', function * () {
      const source_transfer = this.notificationSourceTransferPrepared.resource
      const destination_transfer = source_transfer.credits[0].memo.destination_transfer

      destination_transfer.credits[0].amount = '0.60'
      destination_transfer.credits.push({
        account: 'http://usd-ledger.example/accounts/timothy',
        amount: '0.40'
      })

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      const connectorCredentials = this.config.ledgerCredentials[destination_transfer.ledger]

      nock(destination_transfer.id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, destination_transfer, {state: 'executed'}))

      nock(source_transfer.id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(destination_transfer.id)
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

    it('should only add authorization to the destination transfer debits from the connector\'s account', function * () {
      const source_transfer = this.notificationSourceTransferPrepared.resource
      const destination_transfer = source_transfer.credits[0].memo.destination_transfer

      destination_transfer.debits.unshift({
        amount: '10',
        account: 'http://eur-ledger.example/accounts/other'
      })
      destination_transfer.credits.unshift({
        amount: '10',
        account: 'http://eur-ledger.example/accounts/jane'
      })

      nock(destination_transfer.id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      const connectorCredentials = this.config.ledgerCredentials[destination_transfer.ledger]
      const debitMemo = {
        source_transfer_ledger: source_transfer.ledger,
        source_transfer_id: source_transfer.id
      }
      const authorizedDestinationTransfer = _.merge({}, destination_transfer, {
        debits: [
          {memo: debitMemo},
          {memo: debitMemo, authorized: true}
        ]
      })
      nock(destination_transfer.id)
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
      const source_transfer = this.notificationSourceTransferPrepared.resource
      const destination_transfer = source_transfer.credits[0].memo.destination_transfer

      source_transfer.expires_at = moment(START_DATE - 1).toISOString()
      source_transfer.state = 'executed'

      const connectorCredentials = this.config.ledgerCredentials[destination_transfer.ledger]
      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      nock(destination_transfer.id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, destination_transfer, {state: 'executed'}))

      nock(source_transfer.id)
        .put('/fulfillment', fulfillment)
        .reply(200, fulfillment)

      nock(destination_transfer.id)
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
      const expires_at = future(5000)
      nock(caseID1).get('').reply(200, {expires_at: expires_at})
      nock(caseID2).get('').reply(200, {expires_at: expires_at})

      nock(this.destination_transfer.id)
        .put('', authorizedDestinationTransfer)
        .reply(201, authorizedDestinationTransfer)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferAtomic_TwoCases)
        .expect(200)
        .end()
    })
  })
})

function future (diff) {
  return (new Date(START_DATE + diff)).toISOString()
}
