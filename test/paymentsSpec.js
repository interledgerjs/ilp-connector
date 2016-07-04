'use strict'

const _ = require('lodash')
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('five-bells-connector')._test.logger
const logHelper = require('five-bells-shared/testHelpers/log')
const subscriptions = require('../src/models/subscriptions')
const mockPlugin = require('./mocks/mockPlugin')
const nock = require('nock')
const sinon = require('sinon')
const mock = require('mock-require')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const env = _.cloneDeep(process.env)

describe('Payments', function () {
  logHelper(logger)

  before(function * () {
    mock('ilp-plugin-mock', mockPlugin)
  })

  beforeEach(function * () {
    const pairs = [
      [
        'USD@http://test1.mock',
        'EUR@http://test2.mock'
      ]
    ]
    process.env.CONNECTOR_LEDGERS = JSON.stringify([
      'EUR@http://eur-ledger.example',
      'USD@http://example.com'
    ])
    process.env.UNIT_TEST_OVERRIDE = '1'
    process.env.CONNECTOR_CREDENTIALS = JSON.stringify({
      'http://test1.mock': {
        type: 'mock',
        id: 'http://test1.mock',
        account: 'xyz',
        username: 'bob',
        password: 'bob'
      },
      'http://test2.mock': {
        type: 'mock',
        id: 'http://test2.mock',
        account: 'xyz',
        username: 'bob',
        password: 'bob'
      }
    })
    process.env.CONNECTOR_PAIRS = JSON.stringify(pairs)
    const ledgerInfoNock = nock('http://test2.mock').get('/')
      .reply(200, {
        precision: 10,
        scale: 4
      })
    appHelper.create(this)
    yield this.backend.connect(ratesResponse)
    yield this.routeBroadcaster.reloadLocalRoutes()
    yield subscriptions.subscribePairs(pairs,
      this.ledgers, this.config, this.routeBuilder)

    this.setTimeout = setTimeout
    this.clock = sinon.useFakeTimers(START_DATE)
    ledgerInfoNock.done()

    this.mockPlugin1 = this.ledgers.getLedger('http://test1.mock')
    this.mockPlugin2 = this.ledgers.getLedger('http://test2.mock')
  })

  afterEach(function * () {
    this.clock.restore()
    process.env = _.cloneDeep(env)
  })

  it('should pass on an execution condition fulfillment', function * () {
    const fulfillSpy = sinon.spy(this.mockPlugin2, 'fulfillCondition')
    this.mockPlugin1.emit('fulfill_execution_condition', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'outgoing',
      noteToSelf: {
        source_transfer_id: '130394ed-f621-4663-80dc-910adc66f4c6',
        source_transfer_ledger: 'http://test2.mock'
      }
    }, 'cf:0:')

    sinon.assert.calledOnce(fulfillSpy)
    sinon.assert.calledWith(fulfillSpy, '130394ed-f621-4663-80dc-910adc66f4c6', 'cf:0:')
  })
})
