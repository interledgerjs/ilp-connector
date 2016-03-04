'use strict'
const _ = require('lodash')
const expect = require('chai').expect
const sinon = require('sinon')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const moment = require('moment')
const app = require('five-bells-connector').app
const logger = require('five-bells-connector')._test.logger
const backend = require('five-bells-connector')._test.backend
const appHelper = require('./helpers/app')
const logHelper = require('five-bells-shared/testHelpers/log')
const ratesResponse = require('./data/fxRates.json')
const config = require('five-bells-connector')._test.config.toJS()
const settlementQueue = require('../src/services/settlementQueue')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

// ledger.eu public key: Lvf3YtnHLMER+VHT0aaeEJF+7WQcvp4iKZAdvMVto7c=
// ledger.eu secret: u3HFmtkEHDCNJQwKGT4UfGf0TBqiqDu/2IY7R99Znvsu9/di2ccswRH5UdPRpp4QkX7tZBy+niIpkB28xW2jtw==

describe('Payments', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this, app)
    yield backend.connect(ratesResponse)
    settlementQueue._reset()

    this.clock = sinon.useFakeTimers(START_DATE)

    this.paymentOneToOne =
      _.cloneDeep(require('./data/paymentOneToOne.json'))
    this.paymentOneToOneAtomic =
      _.cloneDeep(require('./data/paymentOneToOneAtomic.json'))
    this.paymentOneToOneAtomic_TwoCases =
      _.cloneDeep(require('./data/paymentOneToOneAtomic_TwoCases.json'))
    this.paymentSameExecutionCondition =
      _.cloneDeep(require('./data/paymentSameExecutionCondition.json'))
    this.paymentOneToMany =
      _.cloneDeep(require('./data/paymentOneToMany.json'))
    this.paymentManyToOne =
      _.cloneDeep(require('./data/paymentManyToOne.json'))
    this.paymentManyToMany =
      _.cloneDeep(require('./data/paymentManyToMany.json'))
    this.transferProposedReceipt =
      _.cloneDeep(require('./data/transferStateProposed.json'))
    this.transferExecutedReceipt =
      _.cloneDeep(require('./data/transferStateExecuted.json'))

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

  describe('PUT /payments/:id', function () {
    it('should return a 400 if the id is not a valid uuid', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.id = 'not valid'

      yield this.request()
        .put('/payments/' + payment.id)
        .send(payment)
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidUriParameterError')
          expect(res.body.message).to.equal('id is not a valid Uuid')
        })
        .end()
    })

    it('should return a 422 if the payment includes multiple source transfers and multiple destination transfers', function *() {
      // Note this behavior may be supported by other connectors but not this one

      const payment = this.formatId(this.paymentManyToMany,
        '/payments/')

      yield this.request()
        .put('/payments/' + this.paymentManyToMany.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('ManyToManyNotSupportedError')
          expect(res.body.message).to.equal('This connector does not support ' +
            'payments that include multiple source transfers and ' +
            'multiple destination transfers')
        })
        .end()
    })

    it('should return a 422 if the two transfer conditions do not match and the source transfer one does not have the public key of the destination ledger', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')

      payment.source_transfers[0].execution_condition =
        _.assign({}, payment.source_transfers[0].execution_condition, {
          public_key: 'Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg='
        })

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableConditionsError')
          expect(res.body.message).to.equal('Source transfer execution ' +
            'condition public key must match the destination ledger\'s.')
        })
        .end()
    })

    it.skip('should return a 422 if the two transfer conditions do not ' +
      'match and the source transfer one does not have the same algorithm the' +
      'destination ledger uses')

    it('should return a 422 if the payment does not include the connector in the source transfer credits', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.source_transfers[0].credits[0].account = 'http://usd-ledger.example/accounts/mary'

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('NoRelatedSourceCreditError')
          expect(res.body.message).to.equal('Connector\'s account must be ' +
            'credited in all source transfers to provide payment')
        })
        .end()
    })

    it('should return a 422 if the payment does not include the connector in the destination transfer debits', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.destination_transfers[0].debits[0].account = 'http://eur-ledger.example/accounts/mary'

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('NoRelatedDestinationDebitError')
          expect(res.body.message).to.equal('Connector\'s account must be ' +
            'debited in all destination transfers to provide payment')
        })
        .end()
    })

    it('should return a 422 if the rate of the payment is worse than the one currently offered', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.source_transfers[0].credits[0].amount = '1.00'

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableRateError')
          expect(res.body.message).to.equal('Payment rate does not match ' +
            'the rate currently offered')
        })
        .end()
    })

    it('should return a 422 if the rate of the payment with multiple source transfers is worse than the one currently offered', function *() {
      const payment = this.formatId(this.paymentManyToOne,
        '/payments/')

      payment.source_transfers[1].debits[0].amount = '6.75'
      payment.source_transfers[1].credits[0].amount = '6.75'

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableRateError')
          expect(res.body.message).to.equal('Payment rate does not match ' +
            'the rate currently offered')
        })
        .end()
    })

    it('should return a 422 if the rate of the payment with multiple destination transfers is worse than the one currently offered', function *() {
      const payment = this.formatId(this.paymentOneToMany,
        '/payments/')

      payment.destination_transfers[1].debits[0].amount = '31'
      payment.destination_transfers[1].credits[0].amount = '31'

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableRateError')
          expect(res.body.message).to.equal('Payment rate does not match ' +
            'the rate currently offered')
        })
        .end()
    })

    it('should return a 422 if the payment includes assets this connector does not offer rates between', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.source_transfers[0].ledger = 'http://abc-ledger.example/ABC'
      payment.destination_transfers[0].ledger =
        'http://xyz-ledger.example/XYZ'

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('AssetsNotTradedError')
          expect(res.body.message).to.equal('This connector does not support ' +
            'the given asset pair')
        })
        .end()
    })

    it('should return a 201 if the source_transfer is not in the prepared or executed state', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.source_transfers[0].state = 'proposed'

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201)
        .expect(function (res) {
          expect(res.body.id).to.equal(payment.id.toLowerCase())
        })
        .end()
    })

    it('should return a 422 if any of the source transfers is expired', function *() {
      const payment = this.formatId(this.paymentManyToOne,
        '/payments/')
      payment.source_transfers[1].expires_at =
        moment(START_DATE - 1).toISOString()

      yield this.request()
        .put('/payments/' + this.paymentManyToOne.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('Transfer has already expired')
        })
        .end()
    })

    it('should return a 422 if any of the destination transfers is expired', function *() {
      const payment = this.formatId(this.paymentOneToMany,
        '/payments/')
      payment.destination_transfers[1].expires_at =
        moment(START_DATE - 1).toISOString()

      yield this.request()
        .put('/payments/' + this.paymentOneToMany.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('Transfer has already expired')
        })
        .end()
    })

    it('should return a 422 if a destination transfer has an execution_condition but no expiry', function *() {
      const payment = this.formatId(this.paymentOneToMany,
        '/payments/')
      delete payment.destination_transfers[1].expires_at

      yield this.request()
        .put('/payments/' + this.paymentOneToMany.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('Destination transfers ' +
            'with execution conditions must have an expires_at field ' +
            'for connector to agree to authorize them')
        })
        .end()
    })

    it('should return a 422 if any of the destination transfers expires too far in the future (causing the connector to hold money for too long)', function *() {
      const payment = this.formatId(this.paymentOneToMany,
        '/payments/')
      payment.destination_transfers[1].expires_at =
        moment(START_DATE + 10001).toISOString()

      yield this.request()
        .put('/payments/' + this.paymentOneToMany.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('Destination transfer expiry is ' +
            'too far in the future. The connector\'s money would need to be ' +
            'held for too long')
        })
        .end()
    })

    it('should return a 422 if the source transfer expires too soon after the destination transfer (we may not be able to execute the source transfer in time)', function *() {
      const payment = this.formatId(this.paymentOneToMany,
        '/payments/')
      payment.source_transfers[0].expires_at =
        payment.destination_transfers[1].expires_at

      yield this.request()
        .put('/payments/' + this.paymentOneToMany.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('The window between the latest ' +
            'destination transfer expiry and the earliest source transfer ' +
            'expiry is insufficient to ensure that we can execute the ' +
            'source transfers')
        })
        .end()
    })

    it('should return a 422 if the source transfer\'s execution condition is the execution of the destination transfer but the destination transfer expires too soon', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.destination_transfers[0].expires_at =
        moment(START_DATE + 999).toISOString()

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('There is insufficient time for ' +
            'the connector to execute the destination transfer before it expires')
        })
        .end()
    })

    it('should return a 422 if the source transfer\'s execution condition is the execution of the destination transfer but the source transfer expires too soon (we may not be able to execute the source transfer in time)', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.source_transfers[0].expires_at =
        moment(START_DATE + 1999).toISOString()

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('There is insufficient time for ' +
            'the connector to execute the destination transfer before the source ' +
            'transfer(s) expire(s)')
        })
        .end()
    })

    it('should accept upper case UUIDs but convert them to lower case', function *() {
      this.paymentOneToOne.id = this.paymentOneToOne.id.toUpperCase()
      const payment = this.formatId(this.paymentOneToOne, '/payments/')

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201)
        .expect(function (res) {
          expect(res.body.id).to.equal(payment.id.toLowerCase())
        })
        .end()
      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(200)
        .end()
    })

    it('should return a 201 for a new payment', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

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
    })

    it('should return a 201 for a new payment even if the connector is also the payee of the destination transfer', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.destination_transfers[0].credits =
        payment.destination_transfers[0].debits

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

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
    })

    it('should return a 201 for a new payment even if the connector is also the payer of the source transfer', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.source_transfers[0].debits =
        payment.source_transfers[0].credits

      const connectorCredentials = config.ledgerCredentials[payment.destination_transfers[0].ledger]

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

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
    })

    // it('should return an error for a UUID that has already been used', function *() {

    // })

    it('should authorize the transfer on the destination ledger', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      // we're testing to make sure this nock gets called
      const destinationTransferNock =
        nock(payment.destination_transfers[0].id)
          .put('', _.merge(_.cloneDeep(payment.destination_transfers[0]), {
            debits: [{
              authorized: true
            }]
          }))
          .reply(201, _.merge(_.cloneDeep(payment.destination_transfers[0]), {
            debits: [{
              authorized: true
            }],
            state: 'executed'
          }))

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

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

      destinationTransferNock.done() // Throw error if this wasn't called
    })

    it('should not authorize the destination transfer when the source isn\'t lying about being prepared', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201)
        .end()
    })

    it('should execute a payment where the source transfer condition is the destination transfer', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(422)
        .end()
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201, _.merge(_.cloneDeep(payment), {
          state: 'executed',
          source_transfers: [{
            state: 'executed'
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorized: true
            }]
          }]
        }))
        .end()
    })

    it('should get the fulfillment and execute the source transfers when the destination transfer response indicates that it has already been executed', function * () {
      const payment = this.formatId(this.paymentSameExecutionCondition, '/payments/')

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      const fulfillment = this.notificationWithConditionFulfillment.related_resources.execution_condition_fulfillment

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      const getDestinationFulfillment = nock(payment.destination_transfers[0].id)
        .get('/fulfillment')
        .reply(200, fulfillment)

      const sourceTransferExecuted = nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      yield this.request()
        .post('/notifications')
        .send({
          id: this.notificationSourceTransferPrepared.id,
          event: 'transfer.update',
          resource: payment.source_transfers[0],
          related_resources: {}
        })
        .expect(422)
        .end()
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201, _.merge(_.cloneDeep(payment), {
          state: 'executed',
          source_transfers: [{
            state: 'executed'
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorized: true
            }]
          }]
        }))
        .end()

      sourceTransferExecuted.done()
      getDestinationFulfillment.done()
    })

    it('should get the fulfillment and execute the source transfers if any of the destination transfers are already executed', function * () {
      const payment = this.formatId(this.paymentOneToMany, '/payments/')

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      const fulfillment = this.notificationWithConditionFulfillment.related_resources.execution_condition_fulfillment

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'prepared'
        }))

      nock(payment.destination_transfers[1].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      const getDestinationFulfillment = nock(payment.destination_transfers[1].id)
        .get('/fulfillment')
        .reply(200, fulfillment)

      const sourceTransferExecuted = nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      yield this.request()
        .post('/notifications')
        .send({
          id: this.notificationSourceTransferPrepared.id,
          event: 'transfer.update',
          resource: payment.source_transfers[0],
          related_resources: {}
        })
        .expect(422)
        .end()
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201, _.merge(_.cloneDeep(payment), {
          state: 'executed',
          source_transfers: [{
            state: 'executed'
          }],
          destination_transfers: [{
            state: 'prepared',
            debits: [{
              authorized: true
            }]
          }, {
            state: 'executed',
            debits: [{
              authorized: true
            }]
          }]
        }))
        .end()

      sourceTransferExecuted.done()
      getDestinationFulfillment.done()
    })

    it('should execute a payment where its account is not the only credit in the source transfer', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.source_transfers[0].debits[0].amount = '21.07'
      payment.source_transfers[0].credits.unshift({
        account: 'http://usd-ledger.example/accounts/mary',
        amount: '20'
      })

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      const connectorCredentials =
      config.ledgerCredentials[payment.destination_transfers[0].ledger]

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .post('/notifications')
        .send({
          id: this.notificationSourceTransferPrepared.id,
          event: 'transfer.update',
          resource: payment.source_transfers[0],
          related_resources: {}
        })
        .expect(422)
        .end()
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201, _.merge(_.cloneDeep(payment), {
          state: 'executed',
          source_transfers: [{
            state: 'executed'
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorized: true
            }]
          }]
        }))
        .end()
    })

    it('should execute a payment where there are multiple debits from its account in the destination transfer', function *() {
      // Note there is no good reason why this should happen but we should
      // be able to handle it appropriately anyway

      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.destination_transfers[0].debits[0].amount = '0.60'
      payment.destination_transfers[0].debits.push({
        account: 'http://eur-ledger.example/accounts/mark',
        amount: '0.40'
      })

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(422)
        .end()
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201, _.merge(_.cloneDeep(payment), {
          state: 'executed',
          source_transfers: [{
            state: 'executed'
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorized: true
            }, {
              authorized: true
            }]
          }]
        }))
        .end()
    })

    it('should execute a payment where there are multiple credits in the destination transfer', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.destination_transfers[0].credits[0].amount = '0.60'
      payment.destination_transfers[0].credits.push({
        account: 'http://usd-ledger.example/accounts/timothy',
        amount: '0.40'
      })

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(422)
        .end()
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201, _.merge(_.cloneDeep(payment), {
          state: 'executed',
          source_transfers: [{
            state: 'executed'
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorized: true
            }]
          }]
        }))
        .end()
    })

    it('should only add authorization to the destination transfer debits from the connector\'s account', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.destination_transfers[0].debits.unshift({
        amount: '10',
        account: 'http://eur-ledger.example/accounts/other'
      })
      payment.destination_transfers[0].credits.unshift({
        amount: '10',
        account: 'http://eur-ledger.example/accounts/jane'
      })

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      const connectorCredentials =
      config.ledgerCredentials[payment.destination_transfers[0].ledger]
      const submittedAuthorization =
      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(422)
        .end()
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201, _.merge(_.cloneDeep(payment), {
          state: 'executed',
          source_transfers: [{
            state: 'executed'
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [
              {}, // Don't add anything to the first one
              {
                authorized: true
              }
            ]
          }]
        }))
        .end()

      submittedAuthorization.done()
    })

    it('should execute a payment with multiple source transfers and one destination transfer', function *() {
      const payment = this.formatId(this.paymentManyToOne,
        '/payments/')

      const fulfillment = this.notificationWithConditionFulfillment.related_resources.execution_condition_fulfillment

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      const getDestinationFulfillment = nock(payment.destination_transfers[0].id)
        .get('/fulfillment')
        .reply(200, fulfillment)

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.source_transfers[1].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      for (let source_transfer of payment.source_transfers) {
        yield this.request()
          .post('/notifications')
          .send({
            id: this.notificationSourceTransferPrepared.id,
            event: 'transfer.update',
            resource: source_transfer,
            related_resources: {}
          })
          .expect(422)
          .end()
      }
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201, _.merge(_.cloneDeep(payment), {
          state: 'executed',
          source_transfers: [{
            state: 'executed'
          }, {
            state: 'executed'
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorized: true
            }]
          }]
        }))
        .end()

      getDestinationFulfillment.done()
    })

    it('should execute a payment where the source transfer\'s expires_at date has passed if the transfer was executed before it expired', function *() {
      const payment = this.formatId(this.paymentOneToOne, '/payments/')
      payment.source_transfers[0].expires_at =
        moment(START_DATE - 1).toISOString()
      payment.source_transfers[0].state = 'executed'

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      const fulfillment = {
        type: this.transferExecutedReceipt.type,
        signature: this.transferExecutedReceipt.signature
      }

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(200, fulfillment)

      nock(payment.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .post('/notifications')
        .send(this.notificationSourceTransferPrepared)
        .expect(422)
        .end()
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201)
        .end()
    })

    it('should execute a many-to-one payment where it is credited in both the source and destination transfers', function *() {
      const payment = this.formatId(this.paymentManyToOne,
        '/payments/')

      payment.destination_transfers[0].credits[0].account =
        'http://usd-ledger.example/accounts/mark'

      const fulfillment = this.notificationWithConditionFulfillment.related_resources.execution_condition_fulfillment

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      const getDestinationFulfillment = nock(payment.destination_transfers[0].id)
        .get('/fulfillment')
        .reply(200, fulfillment)

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.source_transfers[1].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      for (let source_transfer of payment.source_transfers) {
        yield this.request()
          .post('/notifications')
          .send({
            id: this.notificationSourceTransferPrepared.id,
            event: 'transfer.update',
            resource: source_transfer,
            related_resources: {}
          })
          .expect(422)
          .end()
      }
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201, _.merge(_.cloneDeep(payment), {
          state: 'executed',
          source_transfers: [{
            state: 'executed'
          }, {
            state: 'executed'
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorized: true
            }]
          }]
        }))
        .end()

      getDestinationFulfillment.done()
    })

    it('should execute a many-to-one payment where it is debited in both the source and destination transfers', function *() {
      const payment = this.formatId(this.paymentManyToOne,
        '/payments/')

      payment.source_transfers[0].debits[0] = {
        account: 'http://usd-ledger.example/accounts/mark',
        amount: '10',
        authorized: true
      }

      const fulfillment = this.notificationWithConditionFulfillment.related_resources.execution_condition_fulfillment

      const connectorCredentials =
        config.ledgerCredentials[payment.destination_transfers[0].ledger]

      const getDestinationFulfillment = nock(payment.destination_transfers[0].id)
        .get('/fulfillment')
        .reply(200, fulfillment)

      nock(payment.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: connectorCredentials.username,
          pass: connectorCredentials.password
        })
        .reply(201, _.assign({}, payment.destination_transfers[0], {
          state: 'executed'
        }))

      nock(payment.source_transfers[0].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      nock(payment.source_transfers[1].id)
        .put('/fulfillment', fulfillment)
        .reply(201, fulfillment)

      for (let source_transfer of payment.source_transfers) {
        yield this.request()
          .post('/notifications')
          .send({
            id: this.notificationSourceTransferPrepared.id,
            event: 'transfer.update',
            resource: source_transfer,
            related_resources: {}
          })
          .expect(422)
          .end()
      }
      yield this.request()
        .put('/payments/' + this.paymentOneToOne.id)
        .send(payment)
        .expect(201, _.merge(_.cloneDeep(payment), {
          state: 'executed',
          source_transfers: [{
            state: 'executed'
          }, {
            state: 'executed'
          }],
          destination_transfers: [{
            state: 'executed',
            debits: [{
              authorized: true
            }]
          }]
        }))
        .end()

      getDestinationFulfillment.done()
    })
  })

  describe('atomic mode', function () {
    it('should check the expiry on a cancellation condition: valid', function *() {
      const payment = this.formatId(this.paymentOneToOneAtomic, '/payments/')
      const caseID = payment.destination_transfers[0].additional_info.cases[0]
      const getCase = nock(caseID)
        .get('')
        .reply(200, {
          expires_at: future(5000)
        })

      yield this.request()
        .put('/payments/' + this.paymentOneToOneAtomic.id)
        .send(payment)
        .expect(201)
        .end()
      getCase.done()
    })

    it('should check the expiry on a cancellation condition: too long', function *() {
      const payment = this.formatId(this.paymentOneToOneAtomic, '/payments/')
      const caseID = payment.destination_transfers[0].additional_info.cases[0]
      const getCase = nock(caseID)
        .get('')
        .reply(200, { expires_at: future(15000) })

      yield this.request()
        .put('/payments/' + this.paymentOneToOneAtomic.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('Destination transfer expiry is ' +
            'too far in the future. The connector\'s money would need to be ' +
            'held for too long')
        })
        .end()
      getCase.done()
    })

    it('should check the expiry on a cancellation condition: already expired', function *() {
      const payment = this.formatId(this.paymentOneToOneAtomic, '/payments/')
      const caseID = payment.destination_transfers[0].additional_info.cases[0]
      const getCase = nock(caseID)
        .get('')
        .reply(200, { expires_at: future(-15000) })

      yield this.request()
        .put('/payments/' + this.paymentOneToOneAtomic.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('Transfer has already expired')
        })
        .end()
      getCase.done()
    })

    it('should check the expiry on a cancellation condition: missing expiry', function *() {
      const payment = this.formatId(this.paymentOneToOneAtomic, '/payments/')
      const caseID = payment.destination_transfers[0].additional_info.cases[0]
      const getCase = nock(caseID)
        .get('')
        .reply(200, {})

      yield this.request()
        .put('/payments/' + this.paymentOneToOneAtomic.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('Cases must have an expiry.')
        })
        .end()
      getCase.done()
    })

    it('should check the expiry on a cancellation condition: 2 cases, different expiries', function *() {
      const payment = this.formatId(this.paymentOneToOneAtomic_TwoCases, '/payments/')
      const caseID1 = payment.destination_transfers[0].additional_info.cases[0]
      const caseID2 = payment.destination_transfers[0].additional_info.cases[1]
      const getCase1 = nock(caseID1).get('').reply(200, {expires_at: future(5000)})
      const getCase2 = nock(caseID2).get('').reply(200, {expires_at: future(6000)})

      yield this.request()
        .put('/payments/' + this.paymentOneToOneAtomic_TwoCases.id)
        .send(payment)
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('Case expiries don\'t agree')
        })
        .end()
      getCase1.done()
      getCase2.done()
    })

    it('should check the expiry on a cancellation condition: 2 cases, same expiries', function *() {
      const payment = this.formatId(this.paymentOneToOneAtomic_TwoCases, '/payments/')
      const caseID1 = payment.destination_transfers[0].additional_info.cases[0]
      const caseID2 = payment.destination_transfers[0].additional_info.cases[1]
      const expires_at = future(5000)
      const getCase1 = nock(caseID1).get('').reply(200, {expires_at: expires_at})
      const getCase2 = nock(caseID2).get('').reply(200, {expires_at: expires_at})

      yield this.request()
        .put('/payments/' + this.paymentOneToOneAtomic_TwoCases.id)
        .send(payment)
        .expect(201)
        .end()
      getCase1.done()
      getCase2.done()
    })
  })
})

function future (diff) {
  return (new Date(START_DATE + diff)).toISOString()
}
