'use strict'
const chai = require('chai')
const assert = chai.assert
chai.use(require('chai-as-promised'))

const appHelper = require('./helpers/app')
const mockRequire = require('mock-require')
const nock = require('nock')
const sinon = require('sinon')
nock.enableNetConnect(['localhost'])
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const Peer = require('../src/routing/peer').default
const { serializeCcpRouteUpdateRequest } = require('ilp-protocol-ccp')
const { UnreachableError } = require('ilp-packet').Errors

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const PluginMock = require('./mocks/mockPlugin')
mockRequire('ilp-plugin-mock', PluginMock)

describe('Modify Plugins', function () {
  logHelper(logger)

  beforeEach(async function () {
    appHelper.create(this)

    await this.backend.connect()
    await this.accounts.connect()
    await this.routeBroadcaster.reloadLocalRoutes()
    await this.middlewareManager.setup()

    this.clock = sinon.useFakeTimers(START_DATE)
  })

  afterEach(async function () {
    this.clock.restore()
  })

  describe('addPlugin', function () {
    it('should add a new plugin to accounts', async function () {
      assert.equal(this.accounts.accounts.size, 4)
      await this.app.addPlugin('test.eur-ledger-2', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      assert.equal(this.accounts.accounts.size, 5)
    })

    it('should support new ledger', async function () {
      const packetPromise = this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.jpy-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:02.000Z'),
        data: Buffer.alloc(0)
      })

      await assert.isRejected(packetPromise, UnreachableError, /no route found. source=test.usd-ledger destination=test.jpy.ledger\.bob/)

      await this.app.addPlugin('test.jpy-ledger', {
        relation: 'peer',
        assetCode: 'JPY',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })

      this.accounts.getPlugin('test.jpy-ledger').sendData = () => Buffer.alloc(0)

      await this.accounts.getPlugin('test.jpy-ledger')._dataHandler(serializeCcpRouteUpdateRequest({
        speaker: 'test.jpy-ledger',
        routingTableId: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
        currentEpochIndex: 0,
        fromEpochIndex: 0,
        toEpochIndex: 1,
        holdDownTime: 45000,
        withdrawnRoutes: [],
        newRoutes: [{
          prefix: 'test.jpy-ledger',
          path: ['test.jpy-ledger'],
          auth: Buffer.from('RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk=', 'base64'),
          props: []
        }]
      }))

      const packetPromise2 = this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.jpy-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:02.000Z'),
        data: Buffer.alloc(0)
      })

      await assert.isFulfilled(packetPromise2)
    })

    it('should add a peer for the added ledger', async function () {
      await this.app.addPlugin('test.eur-ledger-2', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'eur-ledger-2'
        }
      })

      assert.instanceOf(this.routeBroadcaster.peers.get('test.eur-ledger-2'), Peer)
    })
  })

  describe('removePlugin', function () {
    beforeEach(async function () {
      await this.app.addPlugin('test.jpy-ledger', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'jpy-ledger'
        }
      })

      await this.accounts.getPlugin('test.jpy-ledger')._dataHandler(serializeCcpRouteUpdateRequest({
        speaker: 'test.jpy-ledger',
        routingTableId: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
        currentEpochIndex: 0,
        fromEpochIndex: 0,
        toEpochIndex: 1,
        holdDownTime: 45000,
        withdrawnRoutes: [],
        newRoutes: [{
          prefix: 'test.jpy-ledger',
          path: ['test.jpy-ledger'],
          auth: Buffer.from('RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk=', 'base64'),
          props: []
        }]
      }))
    })

    it('should remove a plugin from accounts', async function () {
      assert.isOk(this.accounts.getPlugin('test.jpy-ledger'))
      await this.app.removePlugin('test.jpy-ledger')
      assert.throws(() => this.accounts.getPlugin('test.jpy-ledger'), 'unknown account id. accountId=test.jpy-ledger')
    })

    it('should no longer route to that plugin', async function () {
      const packetPromise = this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.jpy-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:02.000Z'),
        data: Buffer.alloc(0)
      })

      await assert.isFulfilled(packetPromise)

      await this.app.removePlugin('test.jpy-ledger')

      const packetPromise2 = this.routeBuilder.getNextHopPacket('test.usd-ledger', {
        amount: '100',
        destination: 'test.jpy-ledger.bob',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date('2015-06-16T00:00:02.000Z'),
        data: Buffer.alloc(0)
      })

      await assert.isRejected(packetPromise2, /no route found. source=test.usd-ledger destination=test.jpy-ledger.bob/)
    })

    it('should depeer the removed ledger', async function () {
      assert.isOk(this.routeBroadcaster.peers.get('test.jpy-ledger'))
      await this.app.removePlugin('test.jpy-ledger')

      assert.isNotOk(this.routeBroadcaster.peers.get('test.jpy-ledger'))
    })
  })
})
