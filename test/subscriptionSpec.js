'use strict'

const _ = require('lodash')
const nock = require('nock')
const packet = require('ilp-packet')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const wsHelper = require('./helpers/ws')
const subscriptions = require('../src/models/subscriptions')
const sinon = require('sinon')

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
    await subscriptions.subscribePairs(this.ledgers, this.config, this.routeBuilder, this.backend)

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
    const fulfillmentData = 'ABAB'
    const sendSpy = sinon.spy(
      this.ledgers.getPlugin(destinationTransfer.ledger),
      'sendTransfer')
    const fulfillSpy = sinon.spy(
      this.ledgers.getPlugin(sourceTransfer.ledger),
      'fulfillCondition')

    await this.ledgers.getPlugin(sourceTransfer.ledger)
      .emitAsync('incoming_prepare', {
        id: sourceTransfer.id,
        direction: 'incoming',
        ledger: sourceTransfer.ledger,
        account: sourceTransfer.debits[0].account,
        amount: sourceAmount,
        executionCondition: sourceTransfer.debits[0].execution_condition,
        expiresAt: sourceTransfer.debits[0].expires_at,
        ilp: packet.serializeIlpPayment({
          amount: destinationAmount,
          account: destinationTransfer.credits[0].account
        }).toString('base64')
      })

    sinon.assert.calledOnce(sendSpy)

    const sourceId = sourceTransfer.id.substring(sourceTransfer.id.length - 36)
    await this.ledgers.getPlugin(sourceTransfer.ledger)
      .emitAsync('outgoing_fulfill', {
        id: destinationTransfer.id,
        direction: 'outgoing',
        ledger: destinationTransfer.ledger,
        account: destinationTransfer.debits[0].account,
        amount: destinationAmount,
        executionCondition: destinationTransfer.debits[0].execution_condition,
        noteToSelf: {
          source_transfer_ledger: sourceTransfer.ledger,
          source_transfer_id: sourceId,
          source_transfer_amount: sourceAmount
        }
      }, fulfillment, fulfillmentData)

    sinon.assert.calledOnce(fulfillSpy)
    sinon.assert.calledWith(fulfillSpy, sourceId, fulfillment, fulfillmentData)
  })

  it('should notify the backend of a successful payment', async function () {
    const sourceTransfer = this.transferUsdPrepared
    const destinationTransfer = this.transferEurProposed
    const backendSpy = sinon.spy(this.backend, 'submitPayment')

    const sourceId = sourceTransfer.id.substring(sourceTransfer.id.length - 36)
    await this.ledgers.getPlugin(sourceTransfer.ledger)
      .emitAsync('outgoing_fulfill', {
        id: destinationTransfer.id,
        direction: 'outgoing',
        ledger: destinationTransfer.ledger,
        account: destinationTransfer.debits[0].account,
        amount: destinationTransfer.debits[0].amount,
        executionCondition: destinationTransfer.debits[0].execution_condition,
        noteToSelf: {
          source_transfer_ledger: sourceTransfer.ledger,
          source_transfer_id: sourceId,
          source_transfer_amount: sourceTransfer.debits[0].amount
        }
      }, 'HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok')

    sinon.assert.calledOnce(backendSpy)
    sinon.assert.calledWith(backendSpy, {
      source_ledger: sourceTransfer.ledger,
      source_amount: sourceTransfer.debits[0].amount,
      destination_ledger: destinationTransfer.ledger,
      destination_amount: destinationTransfer.credits[0].amount
    })
  })
})
