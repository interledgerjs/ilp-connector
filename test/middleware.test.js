'use strict'

const assert = require('assert')
const _ = require('lodash')
const appHelper = require('./helpers/app')
const logger = require('../build/common/log')
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
    await this.accounts.startup()
    await this.routeBroadcaster.reloadLocalRoutes()

    this.setTimeout = setTimeout
    this.setInterval = setInterval
    this.clock = sinon.useFakeTimers(START_DATE)

    this.mockPlugin1Wrapped = this.accounts.get('mock.test1').getPlugin()
    this.mockPlugin1 = this.mockPlugin1Wrapped.oldPlugin
    this.mockPlugin2Wrapped = this.accounts.get('mock.test2').getPlugin()
    this.mockPlugin2 = this.mockPlugin2Wrapped.oldPlugin
  })

  afterEach(async function () {
    if (mockPlugin.prototype.sendData.isSinonProxy) {
      mockPlugin.prototype.sendData.restore()
    }
    this.clock.restore()
    process.env = _.cloneDeep(env)
  })

  describe('incoming data middleware', function () {
    describe('with max-packet-amount middleware', function () {
      beforeEach(async function () {
        await this.accounts.addPlugin('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock',
          maxPacketAmount: '100'
        })
        this.routingTable.insert('mock.test3', { nextHop: 'mock.test3', path: [] })
        this.mockPlugin3Wrapped = this.accounts.get('mock.test3').getPlugin()
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

        sinon.stub(mockPlugin.prototype, 'sendData').resolves(fulfillPacket)

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
  })

  describe('outgoing data middleware', function () {
    describe('with alert middleware', function () {
      beforeEach(async function () {
        await this.accounts.addPlugin('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock'
        })
        this.routingTable.insert('mock.test3', { nextHop: 'mock.test3', path: [] })
        this.mockPlugin3Wrapped = this.accounts.get('mock.test3').getPlugin()
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
        const alerts = this.accounts.getMiddleware('alert').alerts

        mAssert.isEmpty(alerts)

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

        const alerts = this.accounts.getMiddleware('alert').alerts

        mAssert.isEmpty(alerts)

        await this.mockPlugin3Wrapped._dataHandler(preparePacket)

        mAssert.isEmpty(alerts)
      })
    })

    describe('with deduplicate middleware', function () {
      beforeEach(async function () {
        await this.accounts.addPlugin('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock'
        })
        this.routingTable.insert('mock.test3', { nextHop: 'mock.test3', path: [] })
        this.mockPlugin3Wrapped = this.accounts.get('mock.test3').getPlugin()
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

        sinon.stub(mockPlugin.prototype, 'sendData').resolves(fulfillPacket)

        await this.mockPlugin3Wrapped._dataHandler(preparePacket)

        const cachedPacket = this.accounts.getMiddleware('deduplicate').packetCache.get('+EpxyhksFbUHDS9LkoTXlg==')
        assert.strictEqual(cachedPacket.amount, '48')
      })

      it('Duplicate Packets response is served from packetCache', async function () {
        const preparePacket = IlpPacket.serializeIlpPrepare({
          amount: '49',
          executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
          expiresAt: new Date(START_DATE + 2000),
          destination: 'mock.test1',
          data: Buffer.alloc(0)
        })
        const fulfillPacket = {
          fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
          data: Buffer.alloc(0)
        }

        this.accounts.getMiddleware('deduplicate').packetCache.set('+EpxyhksFbUHDS9LkoTXlg==',
          {
            amount: '48',
            expiresAt: new Date('2015-06-16T00:00:01.000Z'),
            promise: Promise.resolve(fulfillPacket)
          })

        const result = await this.mockPlugin3Wrapped._dataHandler(preparePacket)
        assert.strictEqual(result.toString(), IlpPacket.serializeIlpFulfill(fulfillPacket).toString())
      })
    })

    describe('with expire middleware', function () {
      beforeEach(async function () {
        await this.accounts.addPlugin('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock'
        })
        this.routingTable.insert('mock.test3', { nextHop: 'mock.test3', path: [] })
        this.mockPlugin3Wrapped = this.accounts.get('mock.test3').getPlugin()
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

        sinon.stub(mockPlugin.prototype, 'sendData').resolves(fulfillPacket)

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

        sinon.stub(mockPlugin.prototype, 'sendData').callsFake(async function () {
          this.clock.tick(2000)
          await new Promise(resolve => setTimeout(resolve, 10000))
          return fulfillPacket
        }.bind(this))

        const result = this.mockPlugin1Wrapped._dataHandler(preparePacket)

        // Order and workings of rest of code in this test is really important! Beware on changing stuff.
        await new Promise(resolve => setTimeout(resolve, 10))
        let promise = result.then(data => {
          assert.strictEqual(data[0], IlpPacket.Type.TYPE_ILP_REJECT, 'must be rejected')
          assert.deepStrictEqual(IlpPacket.deserializeIlpReject(data), {
            code: 'R00',
            message: 'packet expired.',
            triggeredBy: 'test.connie',
            data: Buffer.alloc(0)
          })
        }).catch(error => {
          throw new Error(error)
        })
        this.clock.tick(2000)
        await promise
      })
    })

    describe('with stats middleware', function () {
      beforeEach(async function () {
        await this.accounts.addPlugin('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock'
        })
        this.routingTable.insert('mock.test3', { nextHop: 'mock.test3', path: [] })
        this.mockPlugin3Wrapped = this.accounts.get('mock.test3').getPlugin()
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

        sinon.stub(mockPlugin.prototype, 'sendData').resolves(fulfillPacket)

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

        sinon.stub(mockPlugin.prototype, 'sendData').resolves(rejectPacket)

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

        sinon.stub(mockPlugin.prototype, 'sendData').resolves(Buffer.from('1'))

        await this.mockPlugin1Wrapped._dataHandler(preparePacket)
        const stats = await this.adminApi.getStats()
        assert.equal(stats[0].values.length, 1)
        assert.equal(stats[0].values[0].labels.result, 'failed')
      })
    })

    describe('with validate-fulfillment middleware', function () {
      beforeEach(async function () {
        await this.accounts.addPlugin('mock.test3', {
          relation: 'child',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock'
        })
        this.routingTable.insert('mock.test3', { nextHop: 'mock.test3', path: [] })
        this.mockPlugin3Wrapped = this.accounts.get('mock.test3').getPlugin()
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

        sinon.stub(mockPlugin.prototype, 'sendData').resolves(fulfillPacket)

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

        sinon.stub(mockPlugin.prototype, 'sendData').resolves(fulfillPacket)

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
