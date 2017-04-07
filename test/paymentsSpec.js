'use strict'

const assert = require('assert')
const _ = require('lodash')
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const subscriptions = require('../src/models/subscriptions')
const mockPlugin = require('./mocks/mockPlugin')
const nock = require('nock')
const sinon = require('sinon')
const mock = require('mock-require')
const packet = require('ilp-packet')
const srcTransfer = require('../src/lib/executeSourceTransfer')

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
      ],
      [
        'EUR@mock.test2.',
        'USD@mock.test1.'
      ]
    ]
    process.env.UNIT_TEST_OVERRIDE = '1'
    process.env.CONNECTOR_LEDGERS = JSON.stringify({
      'mock.test1.': {
        currency: 'USD',
        plugin: 'ilp-plugin-mock',
        options: {
          type: 'mock',
          host: 'http://test1.mock',
          account: 'xyz',
          username: 'bob',
          password: 'bob'
        }
      },
      'mock.test2.': {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {
          type: 'mock',
          host: 'http://test2.mock',
          account: 'xyz',
          username: 'bob',
          password: 'bob'
        }
      }
    })
    process.env.CONNECTOR_PAIRS = JSON.stringify(pairs)
    nock('http://test1.mock').get('/')
      .reply(200, { precision: 10, scale: 4 })
    nock('http://test2.mock').get('/')
      .reply(200, { precision: 10, scale: 4 })

    appHelper.create(this)
    yield this.backend.connect(ratesResponse)
    yield this.ledgers.connect()
    yield this.routeBroadcaster.reloadLocalRoutes()
    yield subscriptions.subscribePairs(this.ledgers.getCore(), this.config, this.routeBuilder, this.messageRouter, this.backend)

    this.setTimeout = setTimeout
    this.setInterval = setInterval
    this.clock = sinon.useFakeTimers(START_DATE)

    this.mockPlugin1 = this.ledgers.getPlugin('mock.test1.')
    this.mockPlugin2 = this.ledgers.getPlugin('mock.test2.')
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
        source_transfer_ledger: 'mock.test2.',
        source_transfer_amount: '1.0'
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
        source_transfer_ledger: 'mock.test2.',
        source_transfer_amount: '1.0'
      }
    }, 'HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok')

    sinon.assert.calledOnce(fulfillSpy)
    sinon.assert.calledWith(fulfillSpy, '130394ed-f621-4663-80dc-910adc66f4c6', 'HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok')
  })

  it('should retry condition fulfillment', function * () {
    const stub = sinon.stub(this.mockPlugin2, 'fulfillCondition')

    // faking the clock triggers the retrying logic faster and makes the test run faster
    let inTestCase = true
    const interval = this.setInterval(() => {
      if (inTestCase) {
        this.clock.tick(1000)
      }
    }, 5)

    stub.onFirstCall().returns(Promise.reject('first fulfillment attempt failed'))
    stub.onSecondCall().returns(Promise.reject('second fulfillment attempt failed'))

    yield this.mockPlugin1.emitAsync('outgoing_fulfill', {
      id: '800c25e5-5db4-4cde-8d34-72edad1601a8',
      direction: 'outgoing',
      noteToSelf: {
        source_transfer_id: '130394ed-f621-4663-80dc-910adc66f4c6',
        source_transfer_ledger: 'mock.test2.',
        source_transfer_amount: '1.0'
      },
      expiresAt: (new Date(START_DATE + 5000)).toISOString()
    }, 'HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok')

    sinon.assert.calledThrice(stub)
    sinon.assert.calledWith(stub, '130394ed-f621-4663-80dc-910adc66f4c6', 'HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok')

    // clean-up the fake timer to avoid side-effects with other tests
    clearInterval(interval)
    inTestCase = false
  })

  it('should not retry on certain errors', function * () {
    // these errors should not trigger a retry
    const errorNames = ['InvalidFieldsError', 'TransferNotFound', 'AlreadyRolledBackError',
      'TransferNotConditionalError', 'NotAcceptedError']

    // faking the clock triggers the retrying logic faster and makes the test run faster
    let inTestCase = true
    const interval = this.setInterval(() => {
      if (inTestCase) {
        this.clock.tick(1000)
      }
    }, 5)

    for (const name of errorNames) {
      const stub = sinon.stub(this.mockPlugin2, 'fulfillCondition')
      const e = new Error()
      e.name = name
      stub.onFirstCall().returns(Promise.reject(e))

      yield this.mockPlugin1.emitAsync('outgoing_fulfill', {
        id: '800c25e5-5db4-4cde-8d34-72edad1601a8',
        direction: 'outgoing',
        noteToSelf: {
          source_transfer_id: '130394ed-f621-4663-80dc-910adc66f4c6',
          source_transfer_ledger: 'mock.test2.',
          source_transfer_amount: '1.0'
        },
        expiresAt: (new Date(START_DATE + 5000)).toISOString()
      }, 'HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok')

      sinon.assert.calledOnce(stub)
      sinon.assert.calledWith(stub, '130394ed-f621-4663-80dc-910adc66f4c6', 'HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok')
      stub.restore()
    }
    // clean-up the fake timer to avoid side-effects with other tests
    clearInterval(interval)
    inTestCase = false
  })

  it('should timeout retrying condition fulfillment', function * () {
    const stub = sinon.stub(this.mockPlugin2, 'fulfillCondition').callsFake(function () {
      return Promise.reject('fulfillment attempt failed')
    })

    const retryOpts = srcTransfer.getRetryOptions()

    // minMessageWindow, expiresFromNow, sinonClockIncrease are all in milliseconds
    const minMessageWindow = this.config.expiry.minMessageWindow * 1000
    const expiresFromNow = 5000 // the source transfer expires in 5 seconds
    const sinonClockIncrease = 100
    // expectedClockTicks is the number of times we expect our fake timer to call clock.tick()
    // before retrying condition fulfillment times out. If the timeout logic does not work as
    // expected, our fake timer is called more often and the test case fails.
    const expectedClockTicks = Math.ceil((expiresFromNow + minMessageWindow) /
        sinonClockIncrease)

    // calculate how often the fulfillment of the source transfer should be attempted
    let expectedTries = 0
    let timePassed = 0
    while (timePassed < (expiresFromNow + minMessageWindow)) {
      // the following formula calculates at which point in time individual retries are attempted
      // for more details refer to http://www.wolframalpha.com/input/?i=Sum%5B10*2%5Ek,+%7Bk,+0,+x%7D%5D+%3D+6+*+1000
      // and https://github.com/tim-kos/node-retry
      timePassed = retryOpts.minTimeout * (Math.pow(retryOpts.factor, expectedTries + 1) - 1)
      expectedTries = expectedTries + 1
    }

    let inTestCase = true
    let clockTicks = 1
    const interval = this.setInterval(() => {
      if (inTestCase) {
        if (clockTicks > expectedClockTicks) {
          // clean-up the fake timer to avoid side-effects with other tests
          clearInterval(interval)
          inTestCase = false
          assert(false, 'Condition fulfillment expected to time out, but it did not.')
        }
        this.clock.tick(sinonClockIncrease)
        clockTicks = clockTicks + 1
      }
    }, 1)

    yield this.mockPlugin1.emitAsync('outgoing_fulfill', {
      id: '800c25e5-5db4-4cde-8d34-72edad1601a8',
      direction: 'outgoing',
      noteToSelf: {
        source_transfer_id: '130394ed-f621-4663-80dc-910adc66f4c6',
        source_transfer_ledger: 'mock.test2.',
        source_transfer_amount: '1.0'
      },
      expiresAt: (new Date(START_DATE + expiresFromNow)).toISOString()
    }, 'HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok')

    sinon.assert.callCount(stub, expectedTries)

    // clean-up the fake timer to avoid side-effects with other tests
    clearInterval(interval)
    inTestCase = false
  })

  it('passes on the executionCondition', function * () {
    const sendSpy = sinon.spy(this.mockPlugin2, 'sendTransfer')
    yield this.mockPlugin1.emitAsync('incoming_prepare', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1.',
      amount: '100',
      executionCondition: 'ni:///sha-256;I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk?fpt=preimage-sha-256&cost=6',
      expiresAt: (new Date(START_DATE + 1000)).toISOString(),
      ilp: packet.serializeIlpPayment({
        account: 'mock.test2.bob',
        amount: '50'
      }).toString('base64')
    })

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, {
      direction: 'outgoing',
      ledger: 'mock.test2.',
      account: 'mock.test2.bob',
      amount: '50',
      executionCondition: 'ni:///sha-256;I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk?fpt=preimage-sha-256&cost=6',
      expiresAt: (new Date(START_DATE)).toISOString(),
      noteToSelf: {
        source_transfer_id: '5857d460-2a46-4545-8311-1539d99e78e8',
        source_transfer_ledger: 'mock.test1.',
        source_transfer_amount: '100'
      }
    })
  })

  it('supports optimistic mode', function * () {
    const sendSpy = sinon.spy(this.mockPlugin2, 'sendTransfer')
    yield this.mockPlugin1.emitAsync('incoming_transfer', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1.',
      amount: '100',
      ilp: packet.serializeIlpPayment({
        account: 'mock.test2.bob',
        amount: '50'
      }).toString('base64')
    })

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, {
      direction: 'outgoing',
      ledger: 'mock.test2.',
      account: 'mock.test2.bob',
      amount: '50',
      noteToSelf: {
        source_transfer_id: '5857d460-2a46-4545-8311-1539d99e78e8',
        source_transfer_ledger: 'mock.test1.',
        source_transfer_amount: '100'
      }
    })
  })

  it('authorizes the payment even if the connector is also the payee of the destination transfer', function * () {
    this.mockPlugin2.FOO = 'bar'
    const sendSpy = sinon.spy(this.mockPlugin2, 'sendTransfer')
    yield this.mockPlugin1.emitAsync('incoming_transfer', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1.',
      amount: '100',
      ilp: packet.serializeIlpPayment({
        account: 'mock.test2.mark',
        amount: '50'
      }).toString('base64')
    })

    sinon.assert.calledOnce(sendSpy)
    sinon.assert.calledWithMatch(sendSpy, {
      direction: 'outgoing',
      ledger: 'mock.test2.',
      account: 'mock.test2.mark',
      amount: '50',
      noteToSelf: {
        source_transfer_id: '5857d460-2a46-4545-8311-1539d99e78e8',
        source_transfer_ledger: 'mock.test1.',
        source_transfer_amount: '100'
      }
    })
  })

  it('rejects the source transfer if settlement fails', function * () {
    const rejectSpy = sinon.spy(this.mockPlugin1, 'rejectIncomingTransfer')
    this.mockPlugin2.sendTransfer = function () {
      return Promise.reject(new Error('fail!'))
    }

    try {
      yield this.mockPlugin1.emitAsync('incoming_prepare', {
        id: '5857d460-2a46-4545-8311-1539d99e78e8',
        direction: 'incoming',
        ledger: 'mock.test1.',
        amount: '100',
        executionCondition: 'ni:///sha-256;I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk?fpt=preimage-sha-256&cost=6',
        expiresAt: (new Date(START_DATE + 1000)).toISOString(),
        ilp: packet.serializeIlpPayment({
          account: 'mock.test2.bob',
          amount: '50'
        }).toString('base64')
      })
    } catch (err) {
      assert.equal(err.message, 'fail!')
      sinon.assert.calledOnce(rejectSpy)
      sinon.assert.calledWith(rejectSpy, '5857d460-2a46-4545-8311-1539d99e78e8', sinon.match({
        code: 'T01',
        name: 'Ledger Unreachable',
        message: 'destination transfer failed: fail!',
        triggered_by: 'mock.test2.bob',
        additional_info: {}
      }))
      return
    }
    assert(false)
  })

  it('rejects with Invalid Packet if the incoming transfer\'s ILP packet isn\'t valid', function * () {
    const rejectSpy = sinon.spy(this.mockPlugin1, 'rejectIncomingTransfer')
    yield this.mockPlugin1.emitAsync('incoming_transfer', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1.',
      amount: '100',
      executionCondition: 'cc:0:',
      expiresAt: (new Date(START_DATE + 1000)).toISOString(),
      ilp: 'junk'
    })
    sinon.assert.calledOnce(rejectSpy)
    sinon.assert.calledWith(rejectSpy, '5857d460-2a46-4545-8311-1539d99e78e8', sinon.match({
      code: 'S01',
      name: 'Invalid Packet',
      message: 'source transfer has invalid ILP packet',
      triggered_by: 'mock.test1.bob',
      additional_info: {}
    }))
  })

  it('rejects with Insufficient Timeout if the incoming transfer is expired', function * () {
    const rejectSpy = sinon.spy(this.mockPlugin1, 'rejectIncomingTransfer')
    yield this.mockPlugin1.emitAsync('incoming_prepare', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1.',
      amount: '100',
      executionCondition: 'cc:0:',
      expiresAt: (new Date(START_DATE - 1)).toISOString(),
      ilp: packet.serializeIlpPayment({
        account: 'mock.test2.bob',
        amount: '50'
      }).toString('base64')
    })
    sinon.assert.calledOnce(rejectSpy)
    sinon.assert.calledWith(rejectSpy, '5857d460-2a46-4545-8311-1539d99e78e8', sinon.match({
      code: 'R03',
      name: 'Insufficient Timeout',
      message: 'Transfer has already expired',
      triggered_by: 'mock.test1.bob',
      additional_info: {}
    }))
  })

  it('rejects with Insufficient Timeout if the incoming transfer expires so soon we cannot create a destination transfer with a sufficient large expiry difference', function * () {
    const rejectSpy = sinon.spy(this.mockPlugin1, 'rejectIncomingTransfer')
    yield this.mockPlugin1.emitAsync('incoming_prepare', {
      id: '5857d460-2a46-4545-8311-1539d99e78e8',
      direction: 'incoming',
      ledger: 'mock.test1.',
      amount: '100',
      executionCondition: 'cc:0:',
      expiresAt: (new Date(START_DATE + 999)).toISOString(),
      ilp: packet.serializeIlpPayment({
        account: 'mock.test2.bob',
        amount: '50'
      }).toString('base64')
    })
    sinon.assert.calledOnce(rejectSpy)
    sinon.assert.calledWith(rejectSpy, '5857d460-2a46-4545-8311-1539d99e78e8', sinon.match({
      code: 'R03',
      name: 'Insufficient Timeout',
      message: 'Not enough time to send payment',
      triggered_by: 'mock.test1.bob',
      additional_info: {}
    }))
  })

  describe('rejection', function () {
    it('relays a cancellation', function * () {
      const rejectSpy = sinon.spy(this.mockPlugin2, 'rejectIncomingTransfer')
      yield this.mockPlugin1.emitAsync('outgoing_cancel', {
        id: '5857d460-2a46-4545-8311-1539d99e78e8',
        direction: 'outgoing',
        ledger: 'mock.test1.',
        noteToSelf: {
          source_transfer_id: '130394ed-f621-4663-80dc-910adc66f4c6',
          source_transfer_ledger: 'mock.test2.',
          source_transfer_amount: '1.0'
        }
      }, {
        code: '123',
        name: 'Error 1',
        message: 'error 1',
        triggered_by: 'foo',
        additional_info: {}
      })
      sinon.assert.calledOnce(rejectSpy)
      sinon.assert.calledWith(rejectSpy, '130394ed-f621-4663-80dc-910adc66f4c6', {
        code: '123',
        name: 'Error 1',
        message: 'error 1',
        triggered_by: 'foo',
        forwarded_by: 'mock.test2.bob',
        additional_info: {}
      })
    })

    it('relays a rejection', function * () {
      const rejectSpy = sinon.spy(this.mockPlugin2, 'rejectIncomingTransfer')
      yield this.mockPlugin1.emitAsync('outgoing_reject', {
        id: '5857d460-2a46-4545-8311-1539d99e78e8',
        direction: 'outgoing',
        ledger: 'mock.test1.',
        noteToSelf: {
          source_transfer_id: '130394ed-f621-4663-80dc-910adc66f4c6',
          source_transfer_ledger: 'mock.test2.',
          source_transfer_amount: '1.0'
        }
      }, {
        code: '123',
        name: 'Error 1',
        message: 'error 1',
        triggered_by: 'foo',
        additional_info: {}
      })
      sinon.assert.calledOnce(rejectSpy)
      sinon.assert.calledWith(rejectSpy, '130394ed-f621-4663-80dc-910adc66f4c6', {
        code: '123',
        name: 'Error 1',
        message: 'error 1',
        triggered_by: 'foo',
        forwarded_by: 'mock.test2.bob',
        additional_info: {}
      })
    })

    it('throws if there is no source_transfer_id', function * () {
      const rejectSpy = sinon.spy(this.mockPlugin2, 'rejectIncomingTransfer')
      try {
        yield this.mockPlugin1.emitAsync('outgoing_cancel', {
          id: '5857d460-2a46-4545-8311-1539d99e78e8',
          direction: 'outgoing',
          ledger: 'mock.test1.',
          noteToSelf: {
            source_transfer_ledger: 'mock.test2.',
            source_transfer_amount: '1.0'
          }
        }, 'error 1')
      } catch (err) {
        assert.equal(err.message, 'Uuid schema validation error: should be string')
        assert(!rejectSpy.called)
        return
      }
      assert(false)
    })
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
        ilp: packet.serializeIlpPayment({
          account: 'mock.test2.bob',
          amount: '50'
        }).toString('base64')
      }
    })

    // One case

    ;[
      {
        label: 'doesn\'t send when the case\'s expiry is too far in the future',
        case: {expires_at: future(15000)},
        message: 'Destination transfer expiry is too far in the future. The connector\'s money would need to be held for too long'
      }, {
        label: 'doesn\'t send when the case has already expired',
        case: {expires_at: future(-15000)},
        message: 'Transfer has already expired'
      }, {
        label: 'doesn\'t send when the case is missing an expiry',
        case: {},
        message: 'Cases must have an expiry.'
      }
    ].forEach(function (data) {
      it(data.label, function * () {
        const sendSpy = sinon.spy(this.mockPlugin2, 'sendTransfer')
        nock(this.caseId1).get('').reply(200, data.case)
        yield this.mockPlugin1.emitAsync('incoming_prepare',
          Object.assign(this.transfer, {cases: [this.caseId1]}))
        assert.equal(sendSpy.called, false)
      })
    })

    // Two cases

    it('doesn\'t send when the cases have different expiries', function * () {
      nock(this.caseId1).get('').reply(200, {expires_at: future(5000)})
      nock(this.caseId2).get('').reply(200, {expires_at: future(6000)})
      const sendSpy = sinon.spy(this.mockPlugin2, 'sendTransfer')
      yield this.mockPlugin1.emitAsync('incoming_prepare',
        Object.assign(this.transfer, {cases: [this.caseId1, this.caseId2]}))
      assert.equal(sendSpy.called, false)
    })

    it('authorizes the payment if the case expiries match', function * () {
      nock(this.caseId1).get('').reply(200, {expires_at: future(5000)})
      nock(this.caseId2).get('').reply(200, {expires_at: future(5000)})

      const sendSpy = sinon.spy(this.mockPlugin2, 'sendTransfer')
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
          source_transfer_ledger: 'mock.test1.',
          source_transfer_amount: '100'
        }
      })
    })
  })
})

function future (diff) {
  return (new Date(START_DATE + diff)).toISOString()
}
