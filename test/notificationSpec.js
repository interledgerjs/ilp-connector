'use strict'
const _ = require('lodash')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const app = require('five-bells-connector').app
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('five-bells-connector')._test.logger
const backend = require('five-bells-connector')._test.backend
const logHelper = require('five-bells-shared/testHelpers/log')
const expect = require('chai').expect
const sinon = require('sinon')
const settlementQueue = require('../src/services/settlementQueue')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

describe('Notifications', function () {
  logHelper(logger)

  describe('POST /notifications', function () {
    beforeEach(function * () {
      appHelper.create(this, app)
      yield backend.connect(ratesResponse)
      settlementQueue._reset()

      this.clock = sinon.useFakeTimers(START_DATE)

      this.paymentOneToOne =
        _.cloneDeep(require('./data/paymentOneToOne.json'))
      this.paymentSameExecutionCondition =
        _.cloneDeep(require('./data/paymentSameExecutionCondition.json'))
      this.paymentOneToMany =
        _.cloneDeep(require('./data/paymentOneToMany.json'))
      this.paymentManyToOne =
        _.cloneDeep(require('./data/paymentManyToOne.json'))
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
    })

    afterEach(function * () {
      expect(nock.pendingMocks()).to.be.empty
      nock.cleanAll()
      this.clock.restore()
    })

    it('should return a 400 if the notification does not have an id field', function *() {
      delete this.notificationNoConditionFulfillment.id
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    // TODO: -shared currently accepts relative URIs as valid IRIs - it shouldn't
    it.skip('should return a 400 if the notification has an invalid id field (simple name)', function *() {
      this.notificationNoConditionFulfillment.id =
        'name'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    it.skip('should return a 400 if the notification has an invalid id field (uuid)', function *() {
      this.notificationNoConditionFulfillment.id =
        '96bdd66f-f37a-4be2-a7b0-4a449d78cd33'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    it('should return a 422 if the notification has a valid id field (uri)', function *() {
      this.notificationNoConditionFulfillment.id =
        'http://example.com/example/1234-5678/blah?foo=bar&bar=baz'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(422)
        .end()
    })

    // TODO: -shared currently does not accept IRIs although it should
    it.skip('should return a 422 if the notification has a valid id field (iri)', function *() {
      this.notificationNoConditionFulfillment.id =
        'http://exämple.com/example/1234-5678/blah?fòo=bar&bar=baz'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(422)
        .end()
    })

    it('should return a 400 if the notification does not have an event field', function *() {
      delete this.notificationNoConditionFulfillment.event
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    it('should return a 400 if the notification has an invalid event field', function *() {
      this.notificationNoConditionFulfillment.event = 'hello there'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    it('should return a 400 if the resource field is not a valid transfer', function *() {
      this.notificationNoConditionFulfillment.resource.additional_field =
        'blah'
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(400)
        .end()
    })

    it('should return a 422 if the notification is not related to a payment the connector has participated in', function *() {
      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnrelatedNotificationError')
          expect(res.body.message).to.equal('Notification does not match a ' +
            'payment we have a record of or the corresponding source ' +
            'transfers may already have been executed')
        })
        .end()
    })

    it('should return a 200 if the notification is properly formatted', function *() {
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
        .put('/payments/' + this.paymentSameExecutionCondition.id)
        .send(payment)
        .expect(201)
        .end()
      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()

      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
        .end()
    })

    it('should submit the source transfer corresponding to the destination transfer it is notified about if its execution condition is the destination transfer', function *() {
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
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201)
        .end()

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
      yield this.request()
        .post('/notifications')
        .send(this.notificationNoConditionFulfillment)
        .expect(200)
        .end()

      // Throw an error if this nock hasn't been executed
      sourceTransferExecuted.done()
    })

    it('should submit the source transfer corresponding to the destination transfer it is notified about if the execution conditions are the same', function *() {
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
        .put('/payments/' + this.paymentSameExecutionCondition.id)
        .send(payment)
        .expect(201)
        .end()

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
        .expect(200)
        .end()

      // Throw an error if this nock hasn't been executed
      sourceTransferExecuted.done()
    })

    it('should submit multiple source transfers if there are multiple that correspond to a single destination transfer it is notified about', function *() {
      const payment = this.formatId(this.paymentManyToOne,
        '/payments/')

      nock(payment.destination_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'prepared'
        }))

      let firstSourceTransferExecuted = nock(payment.source_transfers[0].id)
        .put('/fulfillment',
          this.notificationWithConditionFulfillment
            .resource.execution_condition_fulfillment)
        .reply(201, _.assign({}, payment.source_transfers[0], {
          state: 'executed'
        }))
      let secondSourceTransferExecuted = nock(payment.source_transfers[1].id)
        .put('/fulfillment',
          this.notificationWithConditionFulfillment
            .resource.execution_condition_fulfillment)
        .reply(201, _.assign({}, payment.source_transfers[1], {
          state: 'executed'
        }))

      yield this.request()
        .put('/payments/' + this.paymentManyToOne.id)
        .send(payment)
        .expect(201)
        .end()

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
      yield this.request()
        .post('/notifications')
        .send(_.merge({}, this.notificationSourceTransferPrepared, {
          resource: {id: payment.source_transfers[1].id}
        }))
        .expect(200)
        .end()

      yield this.request()
        .post('/notifications')
        .send(this.notificationWithConditionFulfillment)
        .expect(200)
        .end()

      // Throw an error if this nock hasn't been executed
      firstSourceTransferExecuted.done()
      secondSourceTransferExecuted.done()
    })

    it('should submit multiple source transfers with the right execution conditions even if one has the same condition as the destination transfer and another\'s condition is the destination transfer itself',
      function *() {
        const payment = this.formatId(this.paymentManyToOne,
          '/payments/')
        payment.source_transfers[0].execution_condition =
          this.paymentOneToOne.source_transfers[0].execution_condition

        nock(payment.destination_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, payment.destination_transfers[0], {
            state: 'prepared'
          }))

        nock(payment.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferExecutedReceipt)

        let firstSourceTransferExecuted = nock(payment.source_transfers[0].id)
          .put('/fulfillment', {
            type: 'ed25519-sha512',
            signature: this.transferExecutedReceipt.signature
          })
          .reply(201, _.assign({}, payment.source_transfers[0], {
            state: 'executed'
          }))
        let secondSourceTransferExecuted = nock(payment.source_transfers[1].id)
          .put('/fulfillment',
            this.notificationWithConditionFulfillment
              .resource.execution_condition_fulfillment)
          .reply(201, _.assign({}, payment.source_transfers[1], {
            state: 'executed'
          }))

        yield this.request()
          .put('/payments/' + this.paymentManyToOne.id)
          .send(payment)
          .expect(201)
          .end()

        yield this.request()
          .post('/notifications')
          .send(this.notificationSourceTransferPrepared)
          .expect(200)
          .end()
        yield this.request()
          .post('/notifications')
          .send(_.merge({}, this.notificationSourceTransferPrepared, {
            resource: {id: payment.source_transfers[1].id}
          }))
          .expect(200)
          .end()

        yield this.request()
          .post('/notifications')
          .send(this.notificationWithConditionFulfillment)
          .expect(200)
          .end()

        // Throw an error if this nock hasn't been executed
        firstSourceTransferExecuted.done()
        secondSourceTransferExecuted.done()
      })
  })
})
