'use strict'

const chai = require('chai')
const { assert } = chai
const sinon = require('sinon')
const { cloneDeep } = require('lodash')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../src/common/log')
chai.use(require('chai-as-promised'))
const { serializeCcpRouteUpdateRequest } = require('ilp-protocol-ccp')
const { InvalidPacketError } = require('ilp-packet').Errors

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const env = cloneDeep(process.env)

describe('RouteBuilder', function () {
  logHelper(logger)
  beforeEach(async function () {
    const accountCredentials = {}
    accountCredentials['test.usd-ledger'] = {
      relation: 'peer',
      assetCode: 'USD',
      assetScale: 2,
      plugin: 'ilp-plugin-mock',
      options: {}
    }
    accountCredentials['test.eur-ledger'] = {
      relation: 'peer',
      assetCode: 'EUR',
      assetScale: 2,
      plugin: 'ilp-plugin-mock',
      options: {}
    }
    accountCredentials['test.jpy-ledger'] = {
      relation: 'peer',
      assetCode: 'JPY',
      assetScale: 0,
      plugin: 'ilp-plugin-mock',
      options: {}
    }
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify(accountCredentials)
    process.env.CONNECTOR_SPREAD = '0.1'
    process.env.CONNECTOR_BACKEND_CONFIG = JSON.stringify({
      mockData: {
        base: 'EUR',
        date: '2015-03-18',
        rates: {
          USD: 1.8,
          JPY: 120
        }
      }
    })
    appHelper.create(this)
    this.routeBroadcaster.reloadLocalRoutes()
    await this.middlewareManager.setup()
    await this.accounts.connect()

    const testAccounts = Object.keys(accountCredentials)
    for (let accountId of testAccounts) {
      this.routeBroadcaster.add(accountId)
      this.accounts.getPlugin(accountId)._dataHandler(serializeCcpRouteUpdateRequest({
        speaker: accountId,
        routingTableId: '31812543-9935-4160-bdde-6e459bb37cfe',
        currentEpochIndex: 1,
        fromEpochIndex: 0,
        toEpochIndex: 1,
        holdDownTime: 45000,
        withdrawnRoutes: [],
        newRoutes: [{
          prefix: accountId,
          path: [accountId],
          auth: Buffer.from('fuR3ckUuhB9nRHKW2mAMh/0BHc8p6UuD+iSeV3e734E=', 'base64'),
          props: []
        }]
      }))
    }

    await this.backend.connect()

    this.clock = sinon.useFakeTimers(START_DATE)
  })

  afterEach(async function () {
    this.clock.restore()
    process.env = cloneDeep(env)
  })

  describe('getNextHopPacket', function () {
    it('returns the destination packet if the connector is happy with the request', async function () {
      const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })
      assert.equal(nextHop, 'test.eur-ledger')
      assert.deepEqual(nextHopPacket, {
        amount: '50',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 1000),
        data: Buffer.alloc(0)
      })
    })

    it('returns next packet when source amount is zero', async function () {
      const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '0',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })
      assert.equal(nextHop, 'test.eur-ledger')
      assert.deepEqual(nextHopPacket, {
        amount: '0',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 1000),
        data: Buffer.alloc(0)
      })
    })

    it('returns next packet with zero destination amount when there is not enough money to send a full outbound unit', async function () {
      const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '1',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })
      assert.equal(nextHop, 'test.eur-ledger')
      assert.deepEqual(nextHopPacket, {
        amount: '0',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 1000),
        data: Buffer.alloc(0)
      })
    })

    it('throws error if source ledger is unknown', async function () {
      const packetPromise = this.routeBuilder.getNextHopPacket('test.unknown', {
        amount: '1',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })
      await assert.isRejected(packetPromise, /unknown account id. accountId=test.unknown/)
    })

    it('throws error if destination ledger is unknown', async function () {
      const packetPromise = this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.unknown.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })

      await assert.isRejected(packetPromise, /no route found. source=test.usd-ledger destination=test.unknown.bob/)
    })

    it('applies exchange rate when destination asset is base currency', async function () {
      const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })
      assert.equal(nextHop, 'test.eur-ledger')
      assert.deepEqual(nextHopPacket, {
        amount: '50',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 1000),
        data: Buffer.alloc(0)
      })
    })

    it('applies exchange rate when source asset is base currency', async function () {
      const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket('test.eur-ledger', {
        amount: '50',
        destination: 'test.usd-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })
      assert.equal(nextHop, 'test.usd-ledger')
      assert.deepEqual(nextHopPacket, {
        amount: '81',
        destination: 'test.usd-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 1000),
        data: Buffer.alloc(0)
      })
    })

    it('applies exchange rate when neither source nor destination asset is base currency and rate is < 1', async function () {
      const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.jpy-ledger.jim',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })
      assert.equal(nextHop, 'test.jpy-ledger')
      assert.deepEqual(nextHopPacket, {
        amount: '60',
        destination: 'test.jpy-ledger.jim',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 1000),
        data: Buffer.alloc(0)
      })
    })

    it('applies exchange rate when neither source nor destination asset is base currency and rate is > 1', async function () {
      const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket('test.jpy-ledger', {
        amount: '100',
        destination: 'test.usd-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })
      assert.equal(nextHop, 'test.usd-ledger')
      assert.deepEqual(nextHopPacket, {
        amount: '135',
        destination: 'test.usd-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 1000),
        data: Buffer.alloc(0)
      })
    })

    it('applies 1:1 exchange rate when source and destination are the same', async function () {
      const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })
      assert.equal(nextHop, 'test.eur-ledger')
      assert.deepEqual(nextHopPacket, {
        amount: '50',
        destination: 'test.eur-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 1000),
        data: Buffer.alloc(0)
      })
    })

    describe('with a route from test.eur-ledger → test.cny-ledger', function () {
      beforeEach(async function () {
        this.routingTable.insert('test.cny-ledger', {
          nextHop: 'test.eur-ledger',
          path: []
        })
      })

      it('returns next packet when the connector knows a route to the destination', async function () {
        const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket('test.usd-ledger', {
          amount: '100',
          destination: 'test.cny-ledger.carl',
          executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
          expiresAt: new Date('2015-06-16T00:00:02.000Z'),
          data: Buffer.alloc(0)
        })
        assert.equal(nextHop, 'test.eur-ledger')
        assert.deepEqual(nextHopPacket, {
          amount: '50',
          destination: 'test.cny-ledger.carl',
          executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
          expiresAt: new Date('2015-06-16T00:00:01.000Z'),
          data: Buffer.alloc(0)
        })
      })
    })

    it('throws when there is no path from the source to the destination', async function () {
      await assert.isRejected(this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.cny-ledger.carl',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:01.000Z'),
        data: Buffer.alloc(0)
      }), 'no route found. source=test.usd-ledger destination=test.cny-ledger.carl')
    })

    it('throws when the source transfer has no destination', async function () {
      await assert.isRejected(this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: '',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:01.000Z'),
        data: Buffer.alloc(0)
      }), InvalidPacketError, 'missing destination.')
    })
  })
})
