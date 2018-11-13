'use strict'

const assert = require('assert')
const _ = require('lodash')
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const mockPlugin = require('./mocks/mockPlugin')
const sinon = require('sinon')
const mock = require('mock-require')
const IlpPacket = require('ilp-packet')
const { assert: mAssert } = require('chai')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const env = _.cloneDeep(process.env)

describe('Middleware Manager', function () {
  logHelper(logger)

  before(async function () {
    mock('ilp-plugin-mock', mockPlugin)
  })

  beforeEach(async function () {
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify({
      'mock.test1': {
        relation: 'peer',
        assetCode: 'USD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          type: 'mock',
          host: 'http://test1.mock',
          account: 'xyz',
          username: 'bob',
          password: 'bob'
        }
      },
      'mock.test2': {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
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
    process.env.CONNECTOR_ROUTES = JSON.stringify([{
      targetPrefix: 'mock.test1',
      peerId: 'mock.test1'
    }, {
      targetPrefix: 'mock.test2',
      peerId: 'mock.test2'
    }])

    appHelper.create(this)
    await this.backend.connect()
    await this.accounts.connect()
    await this.routeBroadcaster.reloadLocalRoutes()

    this.setTimeout = setTimeout
    this.setInterval = setInterval
    this.clock = sinon.useFakeTimers(START_DATE)

    this.mockPlugin1Wrapped = this.accounts.getPlugin('mock.test1')
    this.mockPlugin1 = this.mockPlugin1Wrapped.oldPlugin
    this.mockPlugin2Wrapped = this.accounts.getPlugin('mock.test2')
    this.mockPlugin2 = this.mockPlugin2Wrapped.oldPlugin
  })

  afterEach(async function () {
    this.clock.restore()
    process.env = _.cloneDeep(env)
  })

  describe('incoming data middleware', function () {
    describe('with balance middleware', function () {
      beforeEach(async function () {
        this.accounts.add('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock',
          balance: {minimum: '-50', maximum: '100'}
        })
        this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
        await this.accounts.connect()
        this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      })

      it('rejects when balance exceeds maximum', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '101',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test1.bob',
          data: Buffer.alloc(0)
        })

        await this.middlewareManager.setup()
        const result = await this.mockPlugin3Wrapped._dataHandler(preparePacket)

        assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
        assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
          code: 'T04',
          message: 'exceeded maximum balance.',
          triggeredBy: 'test.connie',
          data: Buffer.alloc(0)
        })
      })

      it('fulfills when the incoming balance isn\'t too high', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '99',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test1.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin1Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin3Wrapped._dataHandler(preparePacket)

        assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
      })
    })

    describe('with max-packet-amount middleware', function () {
      beforeEach(async function () {
        this.accounts.add('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock',
          maxPacketAmount: '100'
        })
        this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
        await this.accounts.connect()
        this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      })

      it('fulfills when the packet amount is within limit', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '99',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test1.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin1Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin3Wrapped._dataHandler(preparePacket)

        assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
      })

      it('rejects when the packet amount is too high', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '101',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test1.bob',
          data: Buffer.alloc(0)
        })

        await this.middlewareManager.setup()
        const result = await this.mockPlugin3Wrapped._dataHandler(preparePacket)

        assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
        assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
          code: 'F08',
          message: 'packet size too large. maxAmount=100 actualAmount=101',
          triggeredBy: 'test.connie',
          data: Buffer.from([
            0, 0, 0, 0, 0, 0, 0, 101,
            0, 0, 0, 0, 0, 0, 0, 100
          ])
        })
      })
    })

    describe('with rate-limit middleware', function () {
      beforeEach(async function () {
        this.accounts.add('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock',
          rateLimit: {refillCount: 3, capacity: 3}
        })
        this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
        await this.accounts.connect()
        this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      })

      it('rejects when payments arrive too quickly', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test1.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin1Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        for (let i = 0; i < 3; i++) {
          // Empty the token buffer
          await this.mockPlugin3Wrapped._dataHandler(preparePacket)
        }
        const result = await this.mockPlugin3Wrapped._dataHandler(preparePacket)

        assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
        assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
          code: 'T05',
          message: 'too many requests, throttling.',
          triggeredBy: 'test.connie',
          data: Buffer.alloc(0)
        })
      })
    })
  })

  describe('outgoing data middleware', function () {
    describe('with alert middleware', function () {
      beforeEach(async function () {
        this.accounts.add('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock'
        })
        this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
        await this.accounts.connect()
        this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      })

      it('adds an alert for insufficent liquidity', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test1',
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin1Wrapped, 'sendData')
          .resolves(IlpPacket.serializeIlpReject({
            code: 'T04',
            triggeredBy: 'mock.test1',
            message: 'exceeded maximum balance.',
            data: Buffer.alloc(0)
          }))
        const alerts = this.middlewareManager.getMiddleware('alert').alerts

        mAssert.isEmpty(alerts)
        await this.middlewareManager.setup()

        await this.mockPlugin3Wrapped._dataHandler(preparePacket)
        mAssert.isNotEmpty(alerts)
      })

      it('doesnt add an alert for normal packet', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test1',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin1Wrapped, 'sendData')
          .resolves(fulfillPacket)

        const alerts = this.middlewareManager.getMiddleware('alert').alerts

        mAssert.isEmpty(alerts)
        await this.middlewareManager.setup()

        await this.mockPlugin3Wrapped._dataHandler(preparePacket)

        mAssert.isEmpty(alerts)
      })
    })

    describe('with balance middleware', function () {
      beforeEach(async function () {
        this.accounts.add('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock',
          balance: {minimum: '-50', maximum: '100'}
        })
        this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
        await this.accounts.connect()
        this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      })

      it('rejects when the next hope has insufficient funds', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '55',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin3Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)

        assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
        assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
          code: 'F00',
          message: 'insufficient funds. oldBalance=0 proposedBalance=-54',
          triggeredBy: 'test.connie',
          data: Buffer.alloc(0)
        })
      })

      it('fulfills when the outgoing balance isn\'t too low', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin3Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)

        assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
      })
    })

    describe('with deduplicate middleware', function () {
      beforeEach(async function () {
        this.accounts.add('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock'
        })
        this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
        await this.accounts.connect()
        this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      })

      it('Adds outgoing packets into duplicate cache', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test1',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin1Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()

        await this.mockPlugin3Wrapped._dataHandler(preparePacket)

        const cachedPacket = this.middlewareManager.getMiddleware('deduplicate').packetCache.values().next().value
        assert.equal(cachedPacket.amount, 48)
      })

      it('Duplicate Packets response is served from packetCache', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test1',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        await this.middlewareManager.setup()
        this.middlewareManager.getMiddleware('deduplicate').packetCache.set('wLGdgkJP9a+6RG/9ZfPM7A==',
          {
            amount: '48',
            expiresAt: new Date('2015-06-16T00:00:01.000Z'),
            promise: Promise.resolve(fulfillPacket)
          })

        const result = await this.mockPlugin3Wrapped._dataHandler(preparePacket)
        assert.equal(result, fulfillPacket)
      })
    })

    describe('with expire middleware', function () {
      beforeEach(async function () {
        this.accounts.add('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock'
        })
        this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
        await this.accounts.connect()
        this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      })

      it('fulfills for responses received within expiration window', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })
        sinon.stub(this.mockPlugin3Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)

        assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
      })

      it('reject for response not received within expiration window', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin3Wrapped, 'sendData').callsFake(async function () {
          this.clock.tick(2000)
          await new Promise(resolve => setTimeout(resolve, 10000))
          return fulfillPacket
        }.bind(this))

        await this.middlewareManager.setup()
        const result = this.mockPlugin1Wrapped._dataHandler(preparePacket)

        // waiting here is necessary
        await new Promise(resolve => setTimeout(resolve, 10))
        result.then(data => {
          assert.equal(data[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
          assert.deepEqual(IlpPacket.deserializeIlpReject(data), {
            code: 'R00',
            message: 'packet expired.',
            triggeredBy: 'test.connie',
            data: Buffer.alloc(0)
          })
        })
        this.clock.tick(2000)
      })
    })

    describe('with stats middleware', function () {
      beforeEach(async function () {
        this.accounts.add('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock'
        })
        this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
        await this.accounts.connect()
        this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      })

      it('fulfills response increments stats with fulfilled result', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin3Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)
        const stats = await this.adminApi.getStats()
        assert.equal(stats[0].values.length, 1)
        assert.equal(stats[0].values[0].labels.result, 'fulfilled')
        assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
      })

      it('rejected response increments stats with rejected result', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })
        const rejectPacket = IlpPacket.serializeIlpReject({
          code: 'T04',
          triggeredBy: 'mock.test1',
          message: 'exceeded maximum balance.',
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin3Wrapped, 'sendData')
          .resolves(rejectPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)
        const stats = await this.adminApi.getStats()
        assert.equal(stats[0].values.length, 1)
        assert.equal(stats[0].values[0].labels.result, 'rejected')
        assert.equal(result.toString('hex'), rejectPacket.toString('hex'))
      })

      it('failed response increments stats with failed result', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin3Wrapped, 'sendData')
          .resolves(Buffer.from('1'))

        await this.middlewareManager.setup()
        await this.mockPlugin1Wrapped._dataHandler(preparePacket)
        const stats = await this.adminApi.getStats()
        assert.equal(stats[0].values.length, 1)
        assert.equal(stats[0].values[0].labels.result, 'failed')
      })
    })

    describe('with throughput middleware', function () {
      beforeEach(async function () {
        this.accounts.add('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock',
          throughput: {outgoingAmount: '50'}
        })
        this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
        await this.accounts.connect()
        this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      })

      it('fulfills response within the throughput limit', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin3Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)
        assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
      })

      it('rejects response within the throughput limit', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '52',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin3Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)
        assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
        assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
          code: 'T04',
          message: 'exceeded money bandwidth, throttling.',
          triggeredBy: 'test.connie',
          data: Buffer.alloc(0)
        })
      })

      // TODO add test that will ensure some succeed and then fails within overgoing bandwidth in alloted time
    })

    describe('with validate-fulfillment middleware', function () {
      beforeEach(async function () {
        this.accounts.add('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock'
        })
        this.routingTable.insert('mock.test3', {nextHop: 'mock.test3', path: []})
        await this.accounts.connect()
        this.mockPlugin3Wrapped = this.accounts.getPlugin('mock.test3')
      })

      it('fulfills response within the correct fulfillment condition', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin3Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)
        assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
      })

      it('rejects response with incorrect fulfillment condition', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '52',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test3.bob',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = IlpPacket.serializeIlpFulfill({
          fulfillment: Buffer.from('ILPHaxsILPHaxsILPHaxsILPHILPHaxs'),
          data: Buffer.alloc(0)
        })

        sinon.stub(this.mockPlugin3Wrapped, 'sendData')
          .resolves(fulfillPacket)

        await this.middlewareManager.setup()
        const result = await this.mockPlugin1Wrapped._dataHandler(preparePacket)
        assert.equal(result[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
        assert.deepEqual(IlpPacket.deserializeIlpReject(result), {
          code: 'F05',
          message: 'fulfillment did not match expected value.',
          triggeredBy: 'test.connie',
          data: Buffer.alloc(0)
        })
      })
    })
  })
})
