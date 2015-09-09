'use strict'
const _ = require('lodash')
const expect = require('chai').expect
const sinon = require('sinon')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const moment = require('moment')
const config = require('../services/config')
config.tradingPairs = require('./data/tradingPairs')
const app = require('../app')
const logger = require('../services/log')
const appHelper = require('./helpers/app')
const logHelper = require('@ripple/five-bells-shared/testHelpers/log')
const ratesResponse = require('./data/fxRates.json')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

// ledger.eu public key: Lvf3YtnHLMER+VHT0aaeEJF+7WQcvp4iKZAdvMVto7c=
// ledger.eu secret: u3HFmtkEHDCNJQwKGT4UfGf0TBqiqDu/2IY7R99Znvsu9/di2ccswRH5UdPRpp4QkX7tZBy+niIpkB28xW2jtw==

describe('Settlements', function () {
  logHelper(logger)

  beforeEach(function () {
    appHelper.create(this, app)

    this.clock = sinon.useFakeTimers(START_DATE)

    this.settlementOneToOne =
      _.cloneDeep(require('./data/settlementOneToOne.json'))
    this.settlementSameExecutionCondition =
      _.cloneDeep(require('./data/settlementSameExecutionCondition.json'))
    this.settlementOneToMany =
      _.cloneDeep(require('./data/settlementOneToMany.json'))
    this.settlementManyToOne =
      _.cloneDeep(require('./data/settlementManyToOne.json'))
    this.settlementManyToMany =
      _.cloneDeep(require('./data/settlementManyToMany.json'))
    this.settlementWithDestinationFeeTransfers =
      _.cloneDeep(require('./data/settlementWithDestinationFeeTransfers.json'))
    this.transferProposedReceipt =
      _.cloneDeep(require('./data/transferStateProposed.json'))
    this.transferExecutedReceipt =
      _.cloneDeep(require('./data/transferStateExecuted.json'))

    nock('http://api.fixer.io/latest')
      .get('')
      .times(3)
      .reply(200, ratesResponse)
  })

  afterEach(function () {
    nock.cleanAll()
    this.clock.restore()
  })

  describe('PUT /settlements/:id', function () {
    it('should return a 400 if the id is not a valid uuid', function *() {
      const settlement = this.formatId(this.settlementOneToOne,
        '/settlements/')
      settlement.id = 'not valid'

      yield this.request()
        .put('/settlements/' + settlement.id)
        .send(settlement)
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidUriParameterError')
          expect(res.body.message).to.equal('id is not a valid Uuid')
        })
        .end()
    })

    it('should return a 422 if the settlement includes multiple ' +
      'source transfers and multiple destination transfers', function *() {
        // Note this behavior may be supported by other traders but not this one

        const settlement = this.formatId(this.settlementManyToMany,
          '/settlements/')

        yield this.request()
          .put('/settlements/' + this.settlementManyToMany.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('ManyToManyNotSupportedError')
            expect(res.body.message).to.equal('This trader does not support ' +
              'settlements that include multiple source transfers and ' +
              'multiple destination transfers')
          })
          .end()
      })

    it('should return a 422 if the two transfer conditions do not ' +
      'match and the source transfer one does not have the public key of the ' +
      'destination ledger', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')

        settlement.source_transfers[0].execution_condition =
          _.assign({}, settlement.source_transfers[0].execution_condition, {
            public_key: 'Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg='
          })

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferProposedReceipt)

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('UnacceptableConditionsError')
            expect(res.body.message).to.equal('Source transfer execution ' +
              "condition public key must match the destination ledger's.")
          })
          .end()
      })

    it.skip('should return a 422 if the two transfer conditions do not ' +
      'match and the source transfer one does not have the same algorithm the' +
      'destination ledger uses')

    it('should return a 422 if the settlement does not include the ' +
      'trader in the source transfer credits', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.source_transfers[0].credits[0].account = 'http://usd-ledger.example/accounts/mary'

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('NoRelatedSourceCreditError')
            expect(res.body.message).to.equal("Trader's account must be " +
              'credited in all source transfers to provide settlement')
          })
          .end()
      })

    it('should return a 422 if the settlement does not include the ' +
      'trader in the destination transfer debits', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.destination_transfers[0].debits[0].account = 'http://eur-ledger.example/accounts/mary'

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('NoRelatedDestinationDebitError')
            expect(res.body.message).to.equal("Trader's account must be " +
              'debited in all destination transfers to provide settlement')
          })
          .end()
      })

    it('should return a 422 if the rate of the settlement is worse than ' +
      'the one currently offered', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.source_transfers[0].credits[0].amount = '1.00'

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('UnacceptableRateError')
            expect(res.body.message).to.equal('Settlement rate does not match ' +
              'the rate currently offered')
          })
          .end()
      })

    it('should return a 422 if the rate of the settlement with multiple ' +
      'source transfers is worse than the one currently offered', function *() {
        const settlement = this.formatId(this.settlementManyToOne,
          '/settlements/')

        settlement.source_transfers[1].debits[0].amount = '6.75'
        settlement.source_transfers[1].credits[0].amount = '6.75'

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('UnacceptableRateError')
            expect(res.body.message).to.equal('Settlement rate does not match ' +
              'the rate currently offered')
          })
          .end()
      })

    it('should return a 422 if the rate of the settlement with multiple ' +
    'destination transfers is worse than the one currently offered',
      function *() {
        const settlement = this.formatId(this.settlementOneToMany,
          '/settlements/')

        settlement.destination_transfers[1].debits[0].amount = '31'
        settlement.destination_transfers[1].credits[0].amount = '31'

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('UnacceptableRateError')
            expect(res.body.message).to.equal('Settlement rate does not match ' +
              'the rate currently offered')
          })
          .end()
      })

    it('should return a 422 if the settlement includes assets this trader ' +
      'does not offer rates between', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.source_transfers[0].ledger = 'http://abc-ledger.example/ABC'
        settlement.destination_transfers[0].ledger =
          'http://xyz-ledger.example/XYZ'

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('AssetsNotTradedError')
            expect(res.body.message).to.equal('This trader does not support ' +
              'the given asset pair')
          })
          .end()
      })

    it('should return a 422 if the source_transfer is not in the prepared ' +
      'or executed state', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.source_transfers[0].state = 'proposed'

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('FundsNotHeldError')
            expect(res.body.message).to.equal('Source transfer ' +
              'must be in the prepared state for the trader ' +
              'to authorize the destination transfer')
          })
          .end()
      })

    it('should return a 422 if any of the source transfers is expired',
      function *() {
        const settlement = this.formatId(this.settlementManyToOne,
          '/settlements/')
        settlement.source_transfers[1].expires_at =
          moment(START_DATE - 1).toISOString()

        yield this.request()
          .put('/settlements/' + this.settlementManyToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('UnacceptableExpiryError')
            expect(res.body.message).to.equal('Transfer has already expired')
          })
          .end()
      })

    it('should return a 422 if any of the destination transfers is expired',
      function *() {
        const settlement = this.formatId(this.settlementOneToMany,
          '/settlements/')
        settlement.destination_transfers[1].expires_at =
          moment(START_DATE - 1).toISOString()

        yield this.request()
          .put('/settlements/' + this.settlementOneToMany.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('UnacceptableExpiryError')
            expect(res.body.message).to.equal('Transfer has already expired')
          })
          .end()
      })

    it('should return a 422 if a destination transfer has an ' +
      'execution_condition but no expiry', function *() {
        const settlement = this.formatId(this.settlementOneToMany,
          '/settlements/')
        delete settlement.destination_transfers[1].expires_at

        yield this.request()
          .put('/settlements/' + this.settlementOneToMany.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('UnacceptableExpiryError')
            expect(res.body.message).to.equal('Destination transfers ' +
              'with execution conditions must have an expires_at field ' +
              'for trader to agree to authorize them')
          })
          .end()
      })

    it('should return a 422 if any of the destination transfers expires too ' +
    'far in the future (causing the trader to hold money for too long)',
      function *() {
        const settlement = this.formatId(this.settlementOneToMany,
          '/settlements/')
        settlement.destination_transfers[1].expires_at =
          moment(START_DATE + 10001).toISOString()

        yield this.request()
          .put('/settlements/' + this.settlementOneToMany.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('UnacceptableExpiryError')
            expect(res.body.message).to.equal('Destination transfer expiry is ' +
              "too far in the future. The trader's money would need to be " +
              'held for too long')
          })
          .end()
      })

    it('should return a 422 if the source transfer expires too soon after ' +
    'the destination transfer (we may not be able to execute the source ' +
    'transfer in time)',
      function *() {
        const settlement = this.formatId(this.settlementOneToMany,
          '/settlements/')
        settlement.source_transfers[0].expires_at =
          settlement.destination_transfers[1].expires_at

        yield this.request()
          .put('/settlements/' + this.settlementOneToMany.id)
          .send(settlement)
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

    it("should return a 422 if the source transfer's execution condition is " +
    'the execution of the destination transfer but the destination ' +
    'transfer expires too soon',
      function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.destination_transfers[0].expires_at =
          moment(START_DATE + 999).toISOString()

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('UnacceptableExpiryError')
            expect(res.body.message).to.equal('There is insufficient time for ' +
              'the trader to execute the destination transfer before it expires')
          })
          .end()
      })

    it("should return a 422 if the source transfer's execution condition is " +
    'the execution of the destination transfer but the source transfer ' +
    'expires too soon (we may not be able to execute the source ' +
    'transfer in time)',
      function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.source_transfers[0].expires_at =
          moment(START_DATE + 1999).toISOString()

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('UnacceptableExpiryError')
            expect(res.body.message).to.equal('There is insufficient time for ' +
              'the trader to execute the destination transfer before the source ' +
              'transfer(s) expire(s)')
          })
          .end()
      })

    it('should return a 422 if the source transfer does not ' +
      'have source_fee_transfers', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        delete settlement.source_fee_transfers

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('InsufficientFeeError')
            expect(res.body.message).to.equal('Source fee transfer ' +
              'must be paid to account for cost of holding funds')
          })
          .end()
      })

    it('should return a 422 if the source transfer rejection_credits ' +
      'do not cover the cost of holding funds', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.source_fee_transfers[0].credits[0].amount = '.000104'

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('InsufficientFeeError')
            expect(res.body.message).to.equal('Source fees are insufficient ' +
              'to cover the cost of holding funds and paying the fees for ' +
              'the destination transfers')
          })
          .end()
      })

    it('should return a 422 if the source transfer rejection_credits ' +
    'cover the cost of holding funds but there are rejection_credits ' +
    'on the destination side that take more money from our account',
      function *() {
        const settlement = this.formatId(this.settlementWithDestinationFeeTransfers,
          '/settlements/')
        settlement.destination_fee_transfers[0].debits[0].amount = '.9998'

        yield this.request()
          .put('/settlements/' + this.settlementSameExecutionCondition.id)
          .send(settlement)
          .expect(422)
          .expect(function (res) {
            expect(res.body.id).to.equal('InsufficientFeeError')
            expect(res.body.message).to.equal('Source fees are insufficient ' +
              'to cover the cost of holding funds and paying the fees for ' +
              'the destination transfers')
          })
          .end()
      })

    it('should accept upper case UUIDs but convert them to lower case',
      function *() {
        this.settlementOneToOne.id = this.settlementOneToOne.id.toUpperCase()
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferProposedReceipt)

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferExecutedReceipt)

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201)
          .expect(function (res) {
            expect(res.body.id).to.equal(settlement.id.toLowerCase())
          })
          .end()
      })

    it('should return a 201 for a new settlement', function *() {
      const settlement = this.formatId(this.settlementOneToOne, '/settlements/')

      const traderCredentials =
        config.ledgerCredentials[settlement.destination_transfers[0].ledger]

      nock(settlement.destination_transfers[0].id)
        .put('')
        .basicAuth({
          user: traderCredentials.username,
          pass: traderCredentials.password
        })
        .reply(201, _.assign({}, settlement.destination_transfers[0], {
          state: 'executed'
        }))

      nock(settlement.source_transfers[0].id)
        .put('')
        .reply(201, _.assign({}, settlement.source_transfers[0], {
          state: 'executed'
        }))

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferProposedReceipt)

      nock(settlement.destination_transfers[0].id)
        .get('/state')
        .reply(200, this.transferExecutedReceipt)

      yield this.request()
        .put('/settlements/' + this.settlementOneToOne.id)
        .send(settlement)
        .expect(201)
        .end()
    })

    it('should return a 201 for a new settlement even if the trader is also ' +
      'the payee of the destination transfer', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.destination_transfers[0].credits =
          settlement.destination_transfers[0].debits

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferProposedReceipt)

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferExecutedReceipt)

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201)
          .end()
      })

    it('should return a 201 for a new settlement even if the trader is also ' +
      'the payer of the source transfer', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.source_transfers[0].debits =
          settlement.source_transfers[0].credits

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferProposedReceipt)

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferExecutedReceipt)

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201)
          .end()
      })

    // it('should return an error for a UUID that has already been used',
      //   function *() {

    // })

    it('should authorize the transfer on the destination ledger',
      function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')

        // we're testing to make sure this nock gets called
        const destinationTransferNock =
          nock(settlement.destination_transfers[0].id)
            .put('', _.merge(_.cloneDeep(settlement.destination_transfers[0]), {
              debits: [{
                authorized: true
              }]
            }))
            .reply(201, _.merge(_.cloneDeep(settlement.destination_transfers[0]), {
              debits: [{
                authorized: true
              }],
              state: 'executed'
            }))

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .times(2)
          .reply(200, this.transferProposedReceipt)

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed'
          }))

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201)
          .end()

        destinationTransferNock.done() // Throw error if this wasn't called
      })

    it('should execute a settlement where the source transfer ' +
      'condition is the destination transfer', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferProposedReceipt)

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferExecutedReceipt)

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: {
                signature: this.transferExecutedReceipt.signature
              }
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

    it('should execute a settlement where the source transfer ' +
      'condition is equal to the destination transfer condition', function *() {
        // secret: zU/Q8UzeDi4gHeKAFus1sXDNJ+F7id2AdMR8NXhe1slnYVZLVcvPzA2lFFdxef3y0LrIiuCV8jzs6yYDclN8yA==
        const fulfillment = {
          signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPCOzycOM' +
            'pqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
        }

        const settlement = this.formatId(this.settlementSameExecutionCondition,
          '/settlements/')

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[0].id)
          .put('', _.merge(_.cloneDeep(settlement.source_transfers[0]), {
            execution_condition_fulfillment: fulfillment
          }))
          .reply(201, _.merge(_.cloneDeep(settlement.source_transfers[0]), {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: fulfillment
            }],
            destination_transfers: [{
              state: 'executed',
              debits: [{
                authorized: true
              }],
              execution_condition_fulfillment: fulfillment
            }]
          }))
          .end()
      })

    it('should execute a settlement where its account is not the ' +
      'only credit in the source transfer', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.source_transfers[0].debits[0].amount = '21.07'
        settlement.source_transfers[0].credits.unshift({
          account: 'http://usd-ledger.example/accounts/mary',
          amount: '20'
        })

        const traderCredentials =
        config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferProposedReceipt)

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferExecutedReceipt)

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: {
                signature: this.transferExecutedReceipt.signature
              }
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

    it('should execute a settlement where there are multiple debits ' +
      'from its account in the destination transfer', function *() {
        // Note there is no good reason why this should happen but we should
        // be able to handle it appropriately anyway

        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.destination_transfers[0].debits[0].amount = '0.60'
        settlement.destination_transfers[0].debits.push({
          account: 'http://eur-ledger.example/accounts/mark',
          amount: '0.40'
        })

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferProposedReceipt)

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferExecutedReceipt)

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: {
                signature: this.transferExecutedReceipt.signature
              }
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

    it('should execute a settlement where there are multiple credits ' +
      'in the destination transfer', function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.destination_transfers[0].credits[0].amount = '0.60'
        settlement.destination_transfers[0].credits.push({
          account: 'http://usd-ledger.example/accounts/timothy',
          amount: '0.40'
        })

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferProposedReceipt)

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferExecutedReceipt)

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: {
                signature: this.transferExecutedReceipt.signature
              }
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

    it('should only add authorization to the destination transfer ' +
      "debits from the trader's account", function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.destination_transfers[0].debits.unshift({
          amount: '10',
          account: 'http://eur-ledger.example/accounts/other'
        })
        settlement.destination_transfers[0].credits.unshift({
          amount: '10',
          account: 'http://eur-ledger.example/accounts/jane'
        })

        const traderCredentials =
        config.ledgerCredentials[settlement.destination_transfers[0].ledger]
        const submittedAuthorization =
        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferProposedReceipt)

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferExecutedReceipt)

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: {
                signature: this.transferExecutedReceipt.signature
              }
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

    it('should execute a settlement with one source transfer and multiple ' +
      'destination transfers', function *() {
        const settlement = this.formatId(this.settlementOneToMany,
          '/settlements/')

        const fulfillment = {
          signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPC' +
            'OzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
        }

        const traderCredentials0 =
        config.ledgerCredentials[settlement.destination_transfers[0].ledger]
        const submittedAuthorization0 =
        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials0.username,
            pass: traderCredentials0.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        const traderCredentials1 =
        config.ledgerCredentials[settlement.destination_transfers[1].ledger]
        const submittedAuthorization1 =
        nock(settlement.destination_transfers[1].id)
          .put('')
          .basicAuth({
            user: traderCredentials1.username,
            pass: traderCredentials1.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[1], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: fulfillment
            }],
            destination_transfers: [{
              state: 'executed',
              debits: [{
                authorized: true
              }],
              execution_condition_fulfillment: fulfillment
            }, {
              state: 'executed',
              debits: [{
                authorized: true
              }],
              execution_condition_fulfillment: fulfillment
            }]
          }))
          .end()

        submittedAuthorization0.done()
        submittedAuthorization1.done()
      })

    it('should execute a settlement with multiple source transfers and one ' +
      'destination transfer', function *() {
        const settlement = this.formatId(this.settlementManyToOne,
          '/settlements/')

        const fulfillment = {
          signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPC' +
            'OzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
        }

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[1].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: fulfillment
            }, {
              state: 'executed',
              execution_condition_fulfillment: fulfillment
            }],
            destination_transfers: [{
              state: 'executed',
              debits: [{
                authorized: true
              }],
              execution_condition_fulfillment: fulfillment
            }]
          }))
          .end()
      })

    it("should execute a settlement where the source transfer's expires_at " +
    'date has passed if the transfer was executed before it expired',
      function *() {
        const settlement = this.formatId(this.settlementOneToOne,
          '/settlements/')
        settlement.source_transfers[0].expires_at =
          moment(START_DATE - 1).toISOString()
        settlement.source_transfers[0].state = 'executed'

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(200, _.assign({}, settlement.source_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferProposedReceipt)

        nock(settlement.destination_transfers[0].id)
          .get('/state')
          .reply(200, this.transferExecutedReceipt)

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201)
          .end()
      })

    it('should execute a one-to-many settlement where it is credited in ' +
      'both the source and destination transfers', function *() {
        const settlement = this.formatId(this.settlementOneToMany,
          '/settlements/')

        settlement.destination_transfers[1].credits[0].account = 'http://cny-ledger.example/accounts/mark'

        const fulfillment = {
          signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPC' +
            'OzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
        }

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.destination_transfers[1].id)
          .put('')
          .reply(201, _.assign({}, settlement.destination_transfers[1], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: fulfillment
            }],
            destination_transfers: [{
              state: 'executed',
              debits: [{
                authorized: true
              }],
              execution_condition_fulfillment: fulfillment
            }, {
              state: 'executed',
              debits: [{
                authorized: true
              }],
              execution_condition_fulfillment: fulfillment
            }]
          }))
          .end()
      })

    it('should execute a one-to-many settlement where it is debited in ' +
      'both the source and destination transfers', function *() {
        const settlement = this.formatId(this.settlementOneToMany,
          '/settlements/')

        settlement.source_transfers[0].debits[0] = {
          account: 'http://usd-ledger.example/accounts/mark',
          amount: '10',
          authorized: true
        }

        const fulfillment = {
          signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPC' +
            'OzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
        }

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.destination_transfers[1].id)
          .put('')
          .reply(201, _.assign({}, settlement.destination_transfers[1], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: fulfillment
            }],
            destination_transfers: [{
              state: 'executed',
              debits: [{
                authorized: true
              }],
              execution_condition_fulfillment: fulfillment
            }, {
              state: 'executed',
              debits: [{
                authorized: true
              }],
              execution_condition_fulfillment: fulfillment
            }]
          }))
          .end()
      })

    it('should execute a many-to-one settlement where it is credited in ' +
      'both the source and destination transfers', function *() {
        const settlement = this.formatId(this.settlementManyToOne,
          '/settlements/')

        settlement.destination_transfers[0].credits[0].account =
          'http://usd-ledger.example/accounts/mark'

        const fulfillment = {
          signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPC' +
            'OzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
        }

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[1].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: fulfillment
            }, {
              state: 'executed',
              execution_condition_fulfillment: fulfillment
            }],
            destination_transfers: [{
              state: 'executed',
              debits: [{
                authorized: true
              }],
              execution_condition_fulfillment: fulfillment
            }]
          }))
          .end()
      })

    it('should execute a many-to-one settlement where it is debited in ' +
      'both the source and destination transfers', function *() {
        const settlement = this.formatId(this.settlementManyToOne,
          '/settlements/')

        settlement.source_transfers[0].debits[0] = {
          account: 'http://usd-ledger.example/accounts/mark',
          amount: '10',
          authorized: true
        }

        const fulfillment = {
          signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPC' +
            'OzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
        }

        const traderCredentials =
          config.ledgerCredentials[settlement.destination_transfers[0].ledger]

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[1].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        yield this.request()
          .put('/settlements/' + this.settlementOneToOne.id)
          .send(settlement)
          .expect(201, _.merge(_.cloneDeep(settlement), {
            state: 'executed',
            source_transfers: [{
              state: 'executed',
              execution_condition_fulfillment: fulfillment
            }, {
              state: 'executed',
              execution_condition_fulfillment: fulfillment
            }],
            destination_transfers: [{
              state: 'executed',
              debits: [{
                authorized: true
              }],
              execution_condition_fulfillment: fulfillment
            }]
          }))
          .end()
      })

    it('should execute the destination_fee_transfers immediately ' +
      'if present and all the other checks pass', function *() {
        const settlement = this.formatId(this.settlementWithDestinationFeeTransfers,
          '/settlements/')

        const fulfillment = {
          signature: 'g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPC' +
            'OzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=='
        }

        const traderCredentials =
        config.ledgerCredentials[settlement.destination_transfers[0].ledger]
        const submittedFeeTransfer =
        nock(settlement.destination_fee_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_fee_transfers[0], {
            state: 'executed'
          }))

        nock(settlement.destination_transfers[0].id)
          .put('')
          .basicAuth({
            user: traderCredentials.username,
            pass: traderCredentials.password
          })
          .reply(201, _.assign({}, settlement.destination_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        nock(settlement.source_transfers[0].id)
          .put('')
          .reply(201, _.assign({}, settlement.source_transfers[0], {
            state: 'executed',
            execution_condition_fulfillment: fulfillment
          }))

        yield this.request()
          .put('/settlements/' + this.settlementWithDestinationFeeTransfers.id)
          .send(settlement)
          .expect(201)
          .end()

        submittedFeeTransfer.done()
      })
  })
})
