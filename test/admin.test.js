'use strict'

const assert = require('assert')
const sinon = require('sinon')
const { cloneDeep } = require('lodash')
const IlpPacket = require('ilp-packet')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../src/common/log')
const { serializeCcpRouteUpdateRequest } = require('ilp-protocol-ccp')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const env = cloneDeep(process.env)

describe('AdminApi', function () {
  logHelper(logger)
  beforeEach(async function () {
    this.accountData = Object.assign({}, require('./data/accountCredentials.json'))
    Object.keys(this.accountData).forEach((accountId) => {
      this.accountData[accountId] = Object.assign({
        balance: {maximum: '1000'}
      }, this.accountData[accountId])
    })
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify(this.accountData)

    appHelper.create(this)
    this.clock = sinon.useFakeTimers(START_DATE)

    await this.middlewareManager.setup()
    await this.accounts.connect()
    const testAccounts = ['test.cad-ledger', 'test.usd-ledger', 'test.eur-ledger', 'test.cny-ledger']
    for (let accountId of testAccounts) {
      this.routeBroadcaster.add(accountId)
      this.accounts.getPlugin(accountId)._dataHandler(serializeCcpRouteUpdateRequest({
        speaker: accountId,
        routingTableId: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
        currentEpochIndex: 1,
        fromEpochIndex: 0,
        toEpochIndex: 1,
        holdDownTime: 45000,
        withdrawnRoutes: [],
        newRoutes: [{
          prefix: accountId,
          path: [accountId],
          auth: Buffer.from('RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk=', 'base64'),
          props: []
        }]
      }))
    }

    await this.backend.connect()
    await this.routeBroadcaster.reloadLocalRoutes()
  })

  beforeEach(async function () {
    this.mockPlugin1 = this.accounts.getPlugin('test.usd-ledger')
    this.mockPlugin2 = this.accounts.getPlugin('test.eur-ledger')

    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'test.eur-ledger.bob',
      data: Buffer.alloc(0)
    })
    const fulfillPacket = IlpPacket.serializeIlpFulfill({
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.alloc(0)
    })

    const stub = sinon.stub(this.mockPlugin2, 'sendData').resolves(fulfillPacket)
    const result = await this.mockPlugin1._dataHandler(preparePacket)
    assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
    stub.restore()
  })

  afterEach(async function () {
    this.clock.restore()
    process.env = cloneDeep(env)
  })

  describe('getStatus', function () {
    it('returns the status summary', async function () {
      assert.deepEqual(await this.adminApi.getStatus(), {
        balances: {
          'test.cad-ledger': '0',
          'test.usd-ledger': '100',
          'test.eur-ledger': '-94',
          'test.cny-ledger': '0'
        },
        connected: {
          'test.cad-ledger': true,
          'test.usd-ledger': true,
          'test.eur-ledger': true,
          'test.cny-ledger': true
        },
        localRoutingTable: {
          'test.cad-ledger': {
            auth: undefined,
            nextHop: 'test.cad-ledger',
            path: 'test.cad-ledger'
          },
          'test.cny-ledger': {
            auth: undefined,
            nextHop: 'test.cny-ledger',
            path: 'test.cny-ledger'
          },
          'test.connie': {
            auth: undefined,
            nextHop: '',
            path: ''
          },
          'test.eur-ledger': {
            auth: undefined,
            nextHop: 'test.eur-ledger',
            path: 'test.eur-ledger'
          },
          'test.usd-ledger': {
            auth: undefined,
            nextHop: 'test.usd-ledger',
            path: 'test.usd-ledger'
          }
        }
      })
    })
  })

  describe('getRoutingStatus', function () {
    it('returns the routing status', async function () {
      const status = await this.adminApi.getRoutingStatus()
      assert.equal(typeof status.routingTableId, 'string')
      assert.deepEqual(status, {
        routingTableId: status.routingTableId, // this changes every time
        currentEpoch: 5,
        localRoutingTable: {
          'test.connie': { nextHop: '', path: '', auth: undefined },
          'test.cad-ledger': { nextHop: 'test.cad-ledger', path: 'test.cad-ledger', auth: undefined },
          'test.usd-ledger': { nextHop: 'test.usd-ledger', path: 'test.usd-ledger', auth: undefined },
          'test.eur-ledger': { nextHop: 'test.eur-ledger', path: 'test.eur-ledger', auth: undefined },
          'test.cny-ledger': { nextHop: 'test.cny-ledger', path: 'test.cny-ledger', auth: undefined }
        },
        forwardingRoutingTable: {
          'test.connie': { nextHop: '', path: 'test.connie', auth: undefined },
          'test.cad-ledger': { nextHop: 'test.cad-ledger', path: 'test.connie test.cad-ledger', auth: undefined },
          'test.usd-ledger': { nextHop: 'test.usd-ledger', path: 'test.connie test.usd-ledger', auth: undefined },
          'test.eur-ledger': { nextHop: 'test.eur-ledger', path: 'test.connie test.eur-ledger', auth: undefined },
          'test.cny-ledger': { nextHop: 'test.cny-ledger', path: 'test.connie test.cny-ledger', auth: undefined }
        },
        routingLog: [
          {
            prefix: 'test.connie',
            route: { nextHop: '', path: 'test.connie', auth: undefined },
            epoch: 0
          },
          {
            prefix: 'test.cad-ledger',
            route: { nextHop: 'test.cad-ledger', path: 'test.connie test.cad-ledger', auth: undefined },
            epoch: 1
          },
          {
            prefix: 'test.usd-ledger',
            route: { nextHop: 'test.usd-ledger', path: 'test.connie test.usd-ledger', auth: undefined },
            epoch: 2
          },
          {
            prefix: 'test.eur-ledger',
            route: { nextHop: 'test.eur-ledger', path: 'test.connie test.eur-ledger', auth: undefined },
            epoch: 3
          },
          {
            prefix: 'test.cny-ledger',
            route: { nextHop: 'test.cny-ledger', path: 'test.connie test.cny-ledger', auth: undefined },
            epoch: 4
          }
        ],
        peers: {
          'test.cad-ledger': {
            send: { epoch: 0, mode: 'IDLE' },
            receive: {
              routingTableId: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
              epoch: 1
            }
          },
          'test.usd-ledger': {
            send: { epoch: 0, mode: 'IDLE' },
            receive: {
              routingTableId: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
              epoch: 1
            }
          },
          'test.eur-ledger': {
            send: { epoch: 0, mode: 'IDLE' },
            receive: {
              routingTableId: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
              epoch: 1
            }
          },
          'test.cny-ledger': {
            send: { epoch: 0, mode: 'IDLE' },
            receive: {
              routingTableId: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
              epoch: 1
            }
          }
        }
      })
    })
  })

  describe('getAccountStatus', function () {
    it('returns the account status', async function () {
      assert.deepEqual(await this.adminApi.getAccountStatus(), {
        address: 'test.connie',
        accounts: {
          'test.cad-ledger': {
            info: Object.assign({}, this.accountData['test.cad-ledger'], { options: undefined }),
            connected: true
          },
          'test.usd-ledger': {
            info: Object.assign({}, this.accountData['test.usd-ledger'], { options: undefined }),
            connected: true
          },
          'test.eur-ledger': {
            info: Object.assign({}, this.accountData['test.eur-ledger'], { options: undefined }),
            connected: true
          },
          'test.cny-ledger': {
            info: Object.assign({}, this.accountData['test.cny-ledger'], { options: undefined }),
            connected: true
          }
        }
      })
    })
  })

  describe('getBalanceStatus', function () {
    it('returns the balance status', async function () {
      assert.deepEqual(await this.adminApi.getBalanceStatus(), {
        accounts: {
          'test.cad-ledger': { balance: '0', minimum: '-Infinity', maximum: '1000' },
          'test.usd-ledger': { balance: '100', minimum: '-Infinity', maximum: '1000' },
          'test.eur-ledger': { balance: '-94', minimum: '-Infinity', maximum: '1000' },
          'test.cny-ledger': { balance: '0', minimum: '-Infinity', maximum: '1000' }
        }
      })
    })
  })

  describe('getBackendStatus', function () {
    it('returns the rate backend status', async function () {
      const rates = await this.adminApi.getBackendStatus()
      const accounts = [
        'test.cad-ledger',
        'test.usd-ledger',
        'test.eur-ledger',
        'test.cny-ledger'
      ]
      assert.deepEqual(Object.keys(rates), accounts)
      accounts.forEach((srcAccount) => {
        accounts.forEach((dstAccount) => {
          if (srcAccount === dstAccount) return
          assert.equal(typeof rates[srcAccount][dstAccount], 'number')
        })
      })
    })
  })

  describe('getStats', function () {
    it('returns the collected stats', async function () {
      const metrics = await this.adminApi.getStats()
      const expected = [{
        help: 'Total number of incoming ILP packets',
        name: 'ilp_connector_incoming_ilp_packets',
        type: 'counter',
        values: [{
          value: 1,
          labels:
          {
            result: 'fulfilled',
            account: 'test.cad-ledger',
            asset: 'CAD',
            scale: 4
          },
          timestamp: undefined
        },
        {
          value: 2,
          labels:
          {
            result: 'fulfilled',
            account: 'test.usd-ledger',
            asset: 'USD',
            scale: 4
          },
          timestamp: undefined
        },
        {
          value: 1,
          labels:
          {
            result: 'fulfilled',
            account: 'test.eur-ledger',
            asset: 'EUR',
            scale: 4
          },
          timestamp: undefined
        },
        {
          value: 1,
          labels:
          {
            result: 'fulfilled',
            account: 'test.cny-ledger',
            asset: 'CNY',
            scale: 4
          },
          timestamp: undefined
        }],
        aggregator: 'sum'
      },
      {
        help: 'Total value of incoming ILP packets',
        name: 'ilp_connector_incoming_ilp_packet_value',
        type: 'counter',
        values: [{
          value: 100,
          labels:
          {
            result: 'fulfilled',
            account: 'test.usd-ledger',
            asset: 'USD',
            scale: 4
          },
          timestamp: undefined
        }],
        aggregator: 'sum'
      },
      {
        help: 'Total number of outgoing ILP packets',
        name: 'ilp_connector_outgoing_ilp_packets',
        type: 'counter',
        values: [{
          value: 1,
          labels:
          {
            result: 'fulfilled',
            account: 'test.eur-ledger',
            asset: 'EUR',
            scale: 4
          },
          timestamp: undefined
        }],
        aggregator: 'sum'
      },
      {
        help: 'Total value of outgoing ILP packets',
        name: 'ilp_connector_outgoing_ilp_packet_value',
        type: 'counter',
        values: [{
          value: 94,
          labels:
          {
            result: 'fulfilled',
            account: 'test.eur-ledger',
            asset: 'EUR',
            scale: 4
          },
          timestamp: undefined
        }],
        aggregator: 'sum'
      },
      {
        help: 'Total of incoming money',
        name: 'ilp_connector_incoming_money',
        type: 'gauge',
        values: [],
        aggregator: 'sum'
      },
      {
        help: 'Total of outgoing money',
        name: 'ilp_connector_outgoing_money',
        type: 'gauge',
        values: [],
        aggregator: 'sum'
      },
      {
        help: 'Total of rate limited ILP packets',
        name: 'ilp_connector_rate_limited_ilp_packets',
        type: 'counter',
        values: [],
        aggregator: 'sum'
      },
      {
        help: 'Total of rate limited money requests',
        name: 'ilp_connector_rate_limited_money',
        type: 'counter',
        values: [],
        aggregator: 'sum'
      },
      {
        help: 'Balances on peer account',
        name: 'ilp_connector_balance',
        type: 'gauge',
        values: [{
          value: 100,
          labels: { account: 'test.usd-ledger', asset: 'USD', scale: 4 },
          timestamp: undefined
        },
        {
          value: -94,
          labels: { account: 'test.eur-ledger', asset: 'EUR', scale: 4 },
          timestamp: undefined
        }],
        aggregator: 'sum'
      }]

      assert.deepEqual(metrics, expected)
    })
  })

  describe('postBalance', function () {
    it('adds/subtracts the balance by the given amount', async function () {
      await this.adminApi.postBalance('', { accountId: 'test.cad-ledger', amountDiff: '12' })
      await this.adminApi.postBalance('', { accountId: 'test.cad-ledger', amountDiff: '-34' })
      const balanceMiddleware = this.middlewareManager.getMiddleware('balance')
      assert.equal(
        balanceMiddleware.getStatus().accounts['test.cad-ledger'].balance,
        (12 - 34).toString())
    })

    it('rejects on invalid BalanceUpdate', async function () {
      try {
        await this.adminApi.postBalance('', {})
      } catch (err) {
        return
      }
      assert(false)
    })
  })

  describe('getAlerts', function () {
    it('returns no alerts by default', async function () {
      assert.deepEqual(await this.adminApi.getAlerts(), {alerts: []})
    })

    it('returns an alert when a peer returns "maximum balance exceeded"', async function () {
      sinon.stub(this.mockPlugin2, 'sendData').resolves(IlpPacket.serializeIlpReject({
        code: 'T04',
        triggeredBy: 'test.foo',
        message: 'exceeded maximum balance.',
        data: Buffer.alloc(0)
      }))
      const preparePacket = {
        amount: '100',
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: new Date(START_DATE + 2000),
        destination: 'test.eur-ledger.bob'
      }

      for (let i = 0; i < 3; i++) {
        preparePacket.data = Buffer.from(i.toString())
        await this.mockPlugin1._dataHandler(IlpPacket.serializeIlpPrepare(preparePacket))
      }
      const res = await this.adminApi.getAlerts()
      assert.deepEqual(res, {
        alerts: [{
          id: res.alerts[0].id,
          accountId: 'test.eur-ledger',
          triggeredBy: 'test.foo',
          message: 'exceeded maximum balance.',
          count: 3,
          createdAt: new Date(START_DATE),
          updatedAt: new Date(START_DATE)
        }]
      })
    })
  })

  describe('deleteAlert', function () {
    beforeEach(function () {
      this.alertId = 123
      const middleware = this.middlewareManager.getMiddleware('alert')
      middleware.alerts[this.alertId] = {
        id: this.alertId,
        accountId: 'test.eur-ledger',
        triggeredBy: 'test.foo',
        message: 'the error message',
        count: 123,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })

    it('deletes an alert', async function () {
      await this.adminApi.deleteAlert('/alerts/' + this.alertId, null)
    })
  })
})
