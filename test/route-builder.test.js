'use strict'

const chai = require('chai')
const { assert } = chai
const sinon = require('sinon')
const { cloneDeep } = require('lodash')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../src/common/log')
const InvalidPacketError = require('../src/errors/invalid-packet-error').default
const LiquidityCurve = require('../src/routing/liquidity-curve').default
chai.use(require('chai-as-promised'))

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const ledgerA = 'test.usd-ledger'
const ledgerB = 'test.eur-ledger'
const ledgerC = 'test.cny-ledger'

// sending/receiving users
const bobB = 'test.eur-ledger.bob'
const carlC = 'test.cny-ledger.carl'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const env = cloneDeep(process.env)

describe('RouteBuilder', function () {
  logHelper(logger)
  beforeEach(async function () {
    const accountCredentials = {}
    accountCredentials[ledgerA] = {
      relation: 'peer',
      assetCode: 'USD',
      assetScale: 2,
      plugin: 'ilp-plugin-mock',
      options: {}
    }
    accountCredentials[ledgerB] = {
      relation: 'peer',
      assetCode: 'EUR',
      assetScale: 2,
      plugin: 'ilp-plugin-mock',
      options: {}
    }
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify(accountCredentials)
    process.env.CONNECTOR_SPREAD = '0.1'
    appHelper.create(this)
    this.routeBroadcaster.reloadLocalRoutes()
    await this.middlewareManager.setup()

    const testAccounts = [ledgerA, ledgerB]
    for (let accountId of testAccounts) {
      this.routeBroadcaster.add(accountId)
      this.accounts.getPlugin(accountId)._dataHandler(Buffer.from(JSON.stringify({
        method: 'broadcast_routes',
        data: {
          speaker: accountId,
          routing_table_id: '31812543-9935-4160-bdde-6e459bb37cfe',
          from_epoch: 0,
          to_epoch: 1,
          hold_down_time: 45000,
          withdrawn_routes: [],
          new_routes: [{
            prefix: accountId,
            path: [accountId],
            auth: 'fuR3ckUuhB9nRHKW2mAMh/0BHc8p6UuD+iSeV3e734E='
          }]
        }
      })))
    }

    await this.backend.connect({
      base: 'EUR',
      date: '2015-03-18',
      rates: {
        USD: 1.8
      }
    })

    this.clock = sinon.useFakeTimers(START_DATE)

    await this.accounts.connect()
  })

  afterEach(async function () {
    this.clock.restore()
    process.env = cloneDeep(env)
  })

  describe('getNextHopPacket', function () {
    it('returns the destination packet if the connector is happy with the request', async function () {
      const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket(ledgerA, {
        amount: '100',
        destination: bobB,
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        data: Buffer.alloc(0)
      })
      assert.equal(nextHop, ledgerB)
      assert.deepEqual(nextHopPacket, {
        amount: '50',
        destination: bobB,
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 1000),
        data: Buffer.alloc(0)
      })
    })

    describe('with a route from ledgerB → ledgerC', function () {
      beforeEach(async function () {
        const points = [ [0, 0], [200, 100] ]
        this.routingTable.insert(ledgerC, {
          nextHop: ledgerB,
          path: []
        })
        this.quoter.cacheCurve({
          prefix: ledgerC,
          curve: new LiquidityCurve(points),
          expiry: START_DATE + 45000,
          minMessageWindow: 1
        })
      })

      it('returns an intermediate destination transfer when the connector knows a route to the destination', async function () {
        const { nextHop, nextHopPacket } = await this.routeBuilder.getNextHopPacket(ledgerA, {
          amount: '100',
          destination: carlC,
          executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
          expiresAt: new Date('2015-06-16T00:00:02.000Z'),
          data: Buffer.alloc(0)
        })
        assert.equal(nextHop, ledgerB)
        assert.deepEqual(nextHopPacket, {
          amount: '50',
          destination: carlC,
          executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
          expiresAt: new Date('2015-06-16T00:00:01.000Z'),
          data: Buffer.alloc(0)
        })
      })
    })

    it('throws when there is no path from the source to the destination', async function () {
      await assert.isRejected(this.routeBuilder.getNextHopPacket(ledgerA, {
        amount: '100',
        destination: carlC,
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:01.000Z'),
        data: Buffer.alloc(0)
      }), 'no route found. source=test.usd-ledger destination=test.cny-ledger.carl')
    })

    it('throws when the source transfer has no destination', async function () {
      await assert.isRejected(this.routeBuilder.getNextHopPacket(ledgerA, {
        amount: '100',
        destination: '',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:01.000Z'),
        data: Buffer.alloc(0)
      }), InvalidPacketError, 'missing destination.')
    })
  })
})
