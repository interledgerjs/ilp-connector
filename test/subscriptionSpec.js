'use strict'

const _ = require('lodash')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('five-bells-connector')._test.logger
const logHelper = require('./helpers/log')
const wsHelper = require('./helpers/ws')
const subscriptions = require('../src/models/subscriptions')
const sinon = require('sinon')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const env = _.cloneDeep(process.env)

describe('Subscriptions', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)
    yield this.backend.connect(ratesResponse)
    yield this.routeBroadcaster.reloadLocalRoutes()

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

    nock('http://usd-ledger.example').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://usd-ledger.example',
        name: 'mark',
        connector: 'http://localhost'
      })

    nock('http://eur-ledger.example').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://eur-ledger.example',
        name: 'mark',
        connector: 'http://localhost'
      })

    nock('http://cad-ledger.example:1000').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://cad-ledger.example:1000',
        name: 'mark',
        connector: 'http://localhost'
      })

    nock('http://cny-ledger.example').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://cny-ledger.example',
        name: 'mark',
        connector: 'http://localhost'
      })

    this.setTimeout = setTimeout
    this.clock = sinon.useFakeTimers(START_DATE)

    this.wsCadLedger = new wsHelper.Server('ws://cad-ledger.example:1000/accounts/mark/transfers')
    this.wsUsdLedger = new wsHelper.Server('ws://usd-ledger.example/accounts/mark/transfers')
    this.wsEurLedger = new wsHelper.Server('ws://eur-ledger.example/accounts/mark/transfers')
    this.wsEurLedger.on('connection', () => null)
    this.wsCnyLedger = new wsHelper.Server('ws://cny-ledger.example/accounts/mark/transfers')
    yield subscriptions.subscribePairs(require('./data/tradingPairs.json'),
      this.ledgers, this.config, this.routeBuilder)

    this.paymentSameExecutionCondition =
      _.cloneDeep(require('./data/paymentSameExecutionCondition.json'))
    this.notificationSourceTransferPrepared =
      _.cloneDeep(require('./data/notificationSourceTransferPrepared.json'))
    this.notificationWithConditionFulfillment =
      _.cloneDeep(require('./data/notificationWithConditionFulfillment.json'))
  })

  afterEach(function * () {
    nock.cleanAll()
    this.clock.restore()
    process.env = _.cloneDeep(env)
  })

  it('should initiate and complete a universal mode payment', function * () {
    const payment = this.formatId(this.paymentSameExecutionCondition,
      '/payments/')

    const sendSpy = sinon.spy(
      this.ledgers.getLedger(payment.destination_transfers[0].ledger),
      'send')

    const fulfillSpy = sinon.spy(
      this.ledgers.getLedger(payment.source_transfers[0].ledger),
      'fulfillCondition')

    yield this.ledgers.getLedger(payment.source_transfers[0].ledger)
      .emitAsync('receive', {
        id: payment.source_transfers[0].id,
        direction: 'incoming',
        account: payment.source_transfers[0].debits[0].account,
        amount: payment.source_transfers[0].debits[0].amount,
        executionCondition: payment.source_transfers[0].debits[0].execution_condition,
        expiresAt: payment.source_transfers[0].debits[0].expires_at,
        data: {
          ilp_header: {
            ledger: payment.destination_transfers[0].ledger,
            amount: payment.destination_transfers[0].credits[0].amount,
            account: payment.destination_transfers[0].credits[0].account
          }
        }
      })

    sinon.assert.calledOnce(sendSpy)

    const sourceId = payment.source_transfers[0].id
      .substring(payment.source_transfers[0].id.length - 36)
    yield this.ledgers.getLedger(payment.source_transfers[0].ledger)
      .emitAsync('fulfill_execution_condition', {
        id: payment.destination_transfers[0].id,
        direction: 'outgoing',
        account: payment.destination_transfers[0].debits[0].account,
        amount: payment.destination_transfers[0].debits[0].amount,
        executionCondition: payment.destination_transfers[0].debits[0].execution_condition,
        noteToSelf: {
          source_transfer_ledger: payment.source_transfers[0].ledger,
          source_transfer_id: sourceId
        }
      }, 'cf:0:')

    sinon.assert.calledOnce(fulfillSpy)
    sinon.assert.calledWith(fulfillSpy, sourceId, 'cf:0:')
  })
})
