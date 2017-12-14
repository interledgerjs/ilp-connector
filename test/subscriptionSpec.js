'use strict'

const _ = require('lodash')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const wsHelper = require('./helpers/ws')
const sinon = require('sinon')
const IlpPacket = require('ilp-packet')
const { assert } = require('chai')

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const env = _.cloneDeep(process.env)

describe('Subscriptions', function () {
  logHelper(logger)

  beforeEach(async function () {
    appHelper.create(this)
    await this.backend.connect(ratesResponse)
    await this.ledgers.connect()
    await this.routeBroadcaster.reloadLocalRoutes()

    nock('http://usd-ledger.example').get('/')
      .reply(200, {
        currency_code: 'doesn\'t matter, the connector will ignore this',
        currency_scale: 4
      })

    nock('http://eur-ledger.example').get('/')
      .reply(200, {
        currency_code: 'doesn\'t matter, the connector will ignore this',
        currency_scale: 4
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

    this.transferUsdPrepared = _.cloneDeep(require('./data/transferUsdPrepared.json'))
    this.transferEurProposed = _.cloneDeep(require('./data/transferEurProposed.json'))
  })

  afterEach(async function () {
    nock.cleanAll()
    this.clock.restore()
    process.env = _.cloneDeep(env)
    this.wsCadLedger.close()
    this.wsUsdLedger.close()
    this.wsEurLedger.close()
    this.wsCnyLedger.close()
  })

  it('should initiate and complete a universal mode payment', async function () {
    const sourceTransfer = this.transferUsdPrepared
    const destinationTransfer = this.transferEurProposed
    const sourceAmount = '10700'
    const destinationAmount = '10000'
    const fulfillment = 'HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok'
    const fulfillmentData = Buffer.from('ABAB', 'base64')
    const sendStub = sinon.stub(
      this.ledgers.getPlugin(destinationTransfer.ledger),
      'sendTransfer')
      .resolves({
        fulfillment,
        ilp: IlpPacket.serializeIlpFulfillment({
          data: fulfillmentData
        })
      })

    const result = await this.ledgers.getPlugin(sourceTransfer.ledger)
      ._transferHandler({
        amount: sourceAmount,
        executionCondition: sourceTransfer.execution_condition,
        expiresAt: new Date(sourceTransfer.expires_at),
        ilp: IlpPacket.serializeIlpPayment({
          account: destinationTransfer.credits[0].account,
          amount: destinationAmount
        }),
        custom: { }
      })

    sinon.assert.calledOnce(sendStub)

    assert.deepEqual(result, {
      fulfillment,
      ilp: IlpPacket.serializeIlpFulfillment({
        data: fulfillmentData
      })
    })
  })

  it('should notify the backend of a successful payment', async function () {
    const sourceTransfer = this.transferUsdPrepared
    const destinationTransfer = this.transferEurProposed
    const backendSpy = sinon.spy(this.backend, 'submitPayment')
    const sourceAmount = '10700'
    const destinationAmount = '10000'
    const fulfillment = 'HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok'
    const fulfillmentData = Buffer.from('ABAB', 'base64')
    sinon.stub(
      this.ledgers.getPlugin(destinationTransfer.ledger),
      'sendTransfer')
      .resolves({
        fulfillment,
        ilp: IlpPacket.serializeIlpFulfillment({
          data: fulfillmentData
        })
      })

    await this.ledgers.getPlugin(sourceTransfer.ledger)
      ._transferHandler({
        amount: sourceAmount,
        executionCondition: sourceTransfer.execution_condition,
        expiresAt: new Date(sourceTransfer.expires_at),
        ilp: IlpPacket.serializeIlpPayment({
          account: destinationTransfer.credits[0].account,
          amount: destinationAmount
        }),
        custom: { }
      })

    sinon.assert.calledOnce(backendSpy)
    sinon.assert.calledWith(backendSpy, {
      source_ledger: sourceTransfer.ledger,
      source_amount: sourceAmount,
      destination_ledger: destinationTransfer.ledger,
      destination_amount: destinationAmount
    })
  })
})
