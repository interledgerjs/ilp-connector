'use strict'

const assert = require('assert')
const _ = require('lodash')
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('ilp-connector')._test.logger
const logHelper = require('./helpers/log')
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
        'USD@mock.test1.',
        'EUR@mock.test2.'
      ]
    ]
    process.env.UNIT_TEST_OVERRIDE = '1'
    process.env.CONNECTOR_CREDENTIALS = JSON.stringify({
      'mock.test1.': {
        type: 'mock',
        host: 'http://test1.mock',
        account: 'xyz',
        username: 'bob',
        password: 'bob'
      },
      'mock.test2.': {
        type: 'mock',
        host: 'http://test2.mock',
        account: 'xyz',
        username: 'bob',
        password: 'bob'
      }
    })
    process.env.CONNECTOR_PAIRS = JSON.stringify(pairs)
    nock('http://test1.mock').get('/')
      .reply(200, { precision: 10, scale: 4 })
    nock('http://test2.mock').get('/')
      .reply(200, { precision: 10, scale: 4 })

    appHelper.create(this)
    yield this.backend.connect(ratesResponse)
    yield this.routeBroadcaster.reloadLocalRoutes()
    yield subscriptions.subscribePairs(pairs,
      this.core, this.config, this.routeBuilder)

    this.setTimeout = setTimeout
    this.clock = sinon.useFakeTimers(START_DATE)

    this.mockPlugin1 = this.core.getPlugin('mock.test1.')
    this.mockPlugin2 = this.core.getPlugin('mock.test2.')
  })

  afterEach(function * () {
    this.clock.restore()
    process.env = _.cloneDeep(env)
  })

  it('should handle an invalid fulfillment', function * () {
    this.mockPlugin1.emit('outgoing_fulfill', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'outgoing',
      ledger: 'mock.test1.',
      noteToSelf: {
        source_transfer_id: '130394ed-f621-4663-80dc-910adc66f4c6',
        source_transfer_ledger: 'mock.test2.'
      }
    }, 'invalid') // 'invalid' triggers error in mock plugin
  })

  it('should pass on an execution condition fulfillment', function * () {
    const fulfillSpy = sinon.spy(this.mockPlugin2, 'fulfillCondition')
    yield this.mockPlugin1.emitAsync('outgoing_fulfill', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'outgoing',
      ledger: 'mock.test1.',
      noteToSelf: {
        source_transfer_id: '130394ed-f621-4663-80dc-910adc66f4c6',
        source_transfer_ledger: 'mock.test2.'
      }
    }, 'cf:0:')

    sinon.assert.calledOnce(fulfillSpy)
    sinon.assert.calledWith(fulfillSpy, '130394ed-f621-4663-80dc-910adc66f4c6', 'cf:0:')
  })

  it('passes on the executionCondition', function * () {
    const sendSpy = sinon.spy(this.mockPlugin2, 'send')
    yield this.mockPlugin1.emitAsync('incoming_prepare', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1.',
      amount: '100',
      executionCondition: 'cc:0:',
      expiresAt: (new Date(START_DATE + 1000)).toISOString(),
      data: {
        ilp_header: {
          account: 'mock.test2.bob',
          amount: '50'
        }
      }
    })

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, {
      direction: 'outgoing',
      ledger: 'mock.test2.',
      account: 'mock.test2.bob',
      amount: '50',
      executionCondition: 'cc:0:',
      expiresAt: (new Date(START_DATE)).toISOString(),
      noteToSelf: {
        source_transfer_id: '5857d460-2a46-4545-8311-1539d99e78e8',
        source_transfer_ledger: 'mock.test1.'
      }
    })
  })

  it('supports optimistic mode', function * () {
    const sendSpy = sinon.spy(this.mockPlugin2, 'send')
    yield this.mockPlugin1.emitAsync('incoming_transfer', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1.',
      amount: '100',
      data: {
        ilp_header: {
          account: 'mock.test2.bob',
          amount: '50'
        }
      }
    })

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, {
      direction: 'outgoing',
      ledger: 'mock.test2.',
      account: 'mock.test2.bob',
      amount: '50',
      noteToSelf: {
        source_transfer_id: '5857d460-2a46-4545-8311-1539d99e78e8',
        source_transfer_ledger: 'mock.test1.'
      }
    })
  })

  it('authorizes the payment even if the connector is also the payee of the destination transfer', function * () {
    this.mockPlugin2.FOO = 'bar'
    const sendSpy = sinon.spy(this.mockPlugin2, 'send')
    yield this.mockPlugin1.emitAsync('incoming_transfer', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1.',
      amount: '100',
      data: {
        ilp_header: {
          account: 'mock.test2.mark',
          amount: '50'
        }
      }
    })

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, {
      direction: 'outgoing',
      ledger: 'mock.test2.',
      account: 'mock.test2.mark',
      amount: '50',
      noteToSelf: {
        source_transfer_id: '5857d460-2a46-4545-8311-1539d99e78e8',
        source_transfer_ledger: 'mock.test1.'
      }
    })
  })

  it('throws InvalidBodyError if the incoming transfer\'s ilp_header isn\'t an IlpHeader', function * () {
    try {
      yield this.mockPlugin1.emitAsync('incoming_transfer', {
        id: '5857d460-2a46-4545-8311-1539d99e78e8',
        direction: 'incoming',
        ledger: 'mock.test1.',
        amount: '100',
        data: {
          ilp_header: {
            account: 'mock.test2.bob',
            amount: 'woot'
          }
        }
      })
      assert(false)
    } catch (err) {
      assert.equal(err.name, 'InvalidBodyError')
      assert.equal(err.message, 'IlpHeader schema validation error: String does not match pattern: ^[-+]?[0-9]*[.]?[0-9]+([eE][-+]?[0-9]+)?$')
    }
  })

  it('throws UnacceptableExpiryError if the incoming transfer is expired', function * () {
    try {
      yield this.mockPlugin1.emitAsync('incoming_prepare', {
        id: '5857d460-2a46-4545-8311-1539d99e78e8',
        direction: 'incoming',
        ledger: 'mock.test1.',
        amount: '100',
        expiresAt: (new Date(START_DATE - 1)).toISOString(),
        data: {
          ilp_header: {
            account: 'mock.test2.bob',
            amount: '50'
          }
        }
      })
      assert(false)
    } catch (err) {
      assert.equal(err.name, 'UnacceptableExpiryError')
      assert.equal(err.message, 'Transfer has already expired')
    }
  })

  it('throws UnacceptableExpiryError if the incoming transfer expires so soon we cannot create a destination transfer with a sufficient large expiry difference', function * () {
    try {
      yield this.mockPlugin1.emitAsync('incoming_prepare', {
        id: '5857d460-2a46-4545-8311-1539d99e78e8',
        direction: 'incoming',
        ledger: 'mock.test1.',
        amount: '100',
        expiresAt: (new Date(START_DATE + 999)).toISOString(),
        data: {
          ilp_header: {
            account: 'mock.test2.bob',
            amount: '50'
          }
        }
      })
      assert(false)
    } catch (err) {
      assert.equal(err.name, 'UnacceptableExpiryError')
      assert.equal(err.message, 'Not enough time to send payment')
    }
  })

  describe('atomic mode', function () {
    beforeEach(function () {
      this.caseId1 = 'http://notary.example/cases/2cd5bcdb-46c9-4243-ac3f-79046a87a086'
      this.caseId2 = 'http://notary.example/cases/2cd5bcdb-46c9-4243-ac3f-79046a87a087'
      this.transfer = {
        id: '5857d460-2a46-4545-8311-1539d99e78e8',
        direction: 'incoming',
        ledger: 'mock.test1.',
        amount: '100',
        data: {
          ilp_header: {
            account: 'mock.test2.bob',
            amount: '50'
          }
        }
      }
    })

    // One case

    ;[
      {
        label: 'throws UnacceptableExpiryError when the case\'s expiry is too far in the future',
        case: {expires_at: future(15000)},
        message: 'Destination transfer expiry is too far in the future. The connector\'s money would need to be held for too long'
      }, {
        label: 'throws UnacceptableExpiryError when the case has already expired',
        case: {expires_at: future(-15000)},
        message: 'Transfer has already expired'
      }, {
        label: 'throws UnacceptableExpiryError when the case is missing an expiry',
        case: {},
        message: 'Cases must have an expiry.'
      }
    ].forEach(function (data) {
      it(data.label, function * () {
        nock(this.caseId1).get('').reply(200, data.case)
        try {
          yield this.mockPlugin1.emitAsync('incoming_prepare',
            Object.assign(this.transfer, {cases: [this.caseId1]}))
          assert(false)
        } catch (err) {
          assert.equal(err.name, 'UnacceptableExpiryError')
          assert.equal(err.message, data.message)
        }
      })
    })

    // Two cases

    it('throws UnacceptableExpiryError when the cases have different expiries', function * () {
      nock(this.caseId1).get('').reply(200, {expires_at: future(5000)})
      nock(this.caseId2).get('').reply(200, {expires_at: future(6000)})
      try {
        yield this.mockPlugin1.emitAsync('incoming_prepare',
          Object.assign(this.transfer, {cases: [this.caseId1, this.caseId2]}))
        assert(false)
      } catch (err) {
        assert.equal(err.name, 'UnacceptableExpiryError')
        assert.equal(err.message, 'Case expiries don\'t agree')
      }
    })

    it('authorizes the payment if the case expiries match', function * () {
      nock(this.caseId1).get('').reply(200, {expires_at: future(5000)})
      nock(this.caseId2).get('').reply(200, {expires_at: future(5000)})

      const sendSpy = sinon.spy(this.mockPlugin2, 'send')
      yield this.mockPlugin1.emitAsync('incoming_prepare',
        Object.assign(this.transfer, {cases: [this.caseId1, this.caseId2]}))

      sinon.assert.calledOnce(sendSpy)
      sinon.assert.calledWithMatch(sendSpy, {
        direction: 'outgoing',
        ledger: 'mock.test2.',
        account: 'mock.test2.bob',
        amount: '50',
        cases: [this.caseId1, this.caseId2],
        noteToSelf: {
          source_transfer_id: this.transfer.id,
          source_transfer_ledger: 'mock.test1.'
        }
      })
    })
  })
})

function future (diff) {
  return (new Date(START_DATE + diff)).toISOString()
}
