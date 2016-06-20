'use strict'

const _ = require('lodash')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const assert = require('chai').assert
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('five-bells-connector')._test.logger
const logHelper = require('five-bells-shared/testHelpers/log')
const wsHelper = require('./helpers/ws')
const subscriptions = require('../src/models/subscriptions')
const sinon = require('sinon')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const env = _.cloneDeep(process.env)

describe('Subscriptions', function () {
  logHelper(logger)

  beforeEach(function * () {
    process.env.CONNECTOR_LEDGERS = JSON.stringify([
      'EUR@http://eur-ledger.example',
      'USD@http://example.com'
    ])
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
        name: 'mark'
      })

    nock('http://eur-ledger.example').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://eur-ledger.example',
        name: 'mark'
      })

    nock('http://cad-ledger.example:1000').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://cad-ledger.example:1000',
        name: 'mark'
      })

    nock('http://cny-ledger.example').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://cny-ledger.example',
        name: 'mark'
      })

    this.setTimeout = setTimeout
    this.clock = sinon.useFakeTimers(START_DATE)

    this.wsCadLedger = new wsHelper.Server('ws://cad-ledger.example:1000/accounts/mark/transfers')
    this.wsUsdLedger = new wsHelper.Server('ws://usd-ledger.example/accounts/mark/transfers')
    this.wsEurLedger = new wsHelper.Server('ws://eur-ledger.example/accounts/mark/transfers')
    this.wsEurLedger.on('connection', () => null)
    this.wsCnyLedger = new wsHelper.Server('ws://cny-ledger.example/accounts/mark/transfers')
    yield subscriptions.subscribePairs(require('./data/tradingPairs.json'),
      this.ledgers, this.config)

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

    const nockDestinationTransfer = nock(payment.destination_transfers[0].id)
      .put('')
      .reply(201, _.assign({}, payment.destination_transfers[0], {
        state: 'prepared'
      }))

    const nockSourceTransfer = nock(payment.source_transfers[0].id)
      .put('/fulfillment', this.notificationWithConditionFulfillment.related_resources.execution_condition_fulfillment)
      .reply(201, this.notificationWithConditionFulfillment.related_resources.execution_condition_fulfillment)

    this.wsUsdLedger.send(JSON.stringify({
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
    }))

    yield new Promise((resolve) => this.wsUsdLedger.on('message', resolve))

    assert(nockDestinationTransfer.isDone(), 'destination transfer was not prepared')

    this.wsEurLedger.send(JSON.stringify(_.merge({}, this.notificationWithConditionFulfillment,
      {
        resource: {
          debits: [{
            memo: {
              source_transfer_ledger: payment.source_transfers[0].ledger,
              source_transfer_id: payment.source_transfers[0].id
                .substring(payment.source_transfers[0].id.length - 36)
            }
          }]
        }
      }
    )))

    yield new Promise((resolve) => this.wsEurLedger.on('message', resolve))

    assert(nockSourceTransfer.isDone(), 'source transfer was not fulfilled')
  })
})
