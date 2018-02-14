'use strict'

const _ = require('lodash')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const wsHelper = require('./helpers/ws')
const sinon = require('sinon')
const IlpPacket = require('ilp-packet')
const { assert } = require('chai')
const { serializeCcpRouteUpdateRequest } = require('ilp-protocol-ccp')

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const env = _.cloneDeep(process.env)

describe('Subscriptions', function () {
  logHelper(logger)

  beforeEach(async function () {
    appHelper.create(this)
    await this.backend.connect()
    await this.accounts.connect()
    await this.routeBroadcaster.reloadLocalRoutes()
    await this.middlewareManager.setup()

    const testAccounts = ['test.cad-ledger', 'test.usd-ledger', 'test.eur-ledger', 'test.cny-ledger']
    for (let accountId of testAccounts) {
      this.routeBroadcaster.add(accountId)
      await this.accounts.getPlugin(accountId)._dataHandler(serializeCcpRouteUpdateRequest({
        speaker: accountId,
        routingTableId: 'c951b674-c6f5-42ca-83a3-39a8d4e293b3',
        currentEpochIndex: 1,
        fromEpochIndex: 0,
        toEpochIndex: 1,
        holdDownTime: 45000,
        withdrawnRoutes: [],
        newRoutes: [{
          prefix: accountId,
          path: [accountId],
          auth: Buffer.from('dvlOlr8MjK5denVE+B47Mb6ecvJTwGNaC/lPsEwYlP8=', 'base64'),
          props: []
        }]
      }))
    }

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
    const sourceAccount = 'test.usd-ledger'
    const destinationAccount = 'test.eur-ledger'
    const destination = 'test.eur-ledger.bob'
    const executionCondition = Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64')
    const expiresAt = new Date('2015-06-16T00:00:11.000Z')
    const data = Buffer.from('BABA', 'base64')
    const sourceAmount = '10700'
    const destinationAmount = '10081'
    const ilpFulfill = {
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.from('ABAB', 'base64')
    }
    const sendStub = sinon.stub(this.accounts.getPlugin(destinationAccount), 'sendData')
      .resolves(IlpPacket.serializeIlpFulfill(ilpFulfill))

    const result = await this.accounts.getPlugin(sourceAccount)
      ._dataHandler(IlpPacket.serializeIlpPrepare({
        amount: sourceAmount,
        executionCondition,
        expiresAt,
        destination,
        data
      }))

    sinon.assert.calledOnce(sendStub)
    sinon.assert.calledWith(sendStub, sinon.match(packet => assert.deepEqual(IlpPacket.deserializeIlpPrepare(packet), {
      amount: destinationAmount,
      executionCondition,
      expiresAt: new Date(expiresAt - 1000),
      destination,
      data
    }) || true))
    assert.deepEqual(IlpPacket.deserializeIlpFulfill(result), ilpFulfill)
  })

  it('should notify the backend of a successful payment', async function () {
    const sourceAccount = 'test.usd-ledger'
    const destinationAccount = 'test.eur-ledger'
    const destination = 'test.eur-ledger.bob'
    const executionCondition = Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64')
    const expiresAt = new Date('2015-06-16T00:00:11.000Z')
    const data = Buffer.from('BABA', 'base64')
    const sourceAmount = '10700'
    const destinationAmount = '10081'
    const ilpFulfill = {
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.from('ABAB', 'base64')
    }
    sinon.stub(this.accounts.getPlugin(destinationAccount), 'sendData')
      .resolves(IlpPacket.serializeIlpFulfill(ilpFulfill))
    sinon.stub(this.accounts.getPlugin(destinationAccount), 'sendMoney')
      .resolves()
    const backendSpy = sinon.spy(this.backend, 'submitPayment')

    await this.accounts.getPlugin(sourceAccount)
      ._dataHandler(IlpPacket.serializeIlpPrepare({
        amount: sourceAmount,
        executionCondition,
        expiresAt,
        destination,
        data
      }))

    sinon.assert.calledOnce(backendSpy)
    sinon.assert.calledWith(backendSpy, {
      sourceAccount,
      sourceAmount,
      destinationAccount,
      destinationAmount
    })
  })
})
