'use strict'

const chai = require('chai')
const { assert } = chai
const sinon = require('sinon')
const { cloneDeep } = require('lodash')
const IlpPacket = require('ilp-packet')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../src/common/log')
chai.use(require('chai-as-promised'))
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

    sinon.stub(this.mockPlugin2, 'sendData').resolves(fulfillPacket)
    const result = await this.mockPlugin1._dataHandler(preparePacket)
    assert.equal(result.toString('hex'), fulfillPacket.toString('hex'))
  })

  afterEach(async function () {
    this.clock.restore()
    process.env = cloneDeep(env)
  })

  describe('getStatus', function () {
    it('returns the status summary', function () {
      assert.deepEqual(this.adminApi.getStatus(), {
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
    it('returns the routing status', function () {
      const status = this.adminApi.getRoutingStatus()
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
    it('returns the account status', function () {
      assert.deepEqual(this.adminApi.getAccountStatus(), {
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
    it('returns the balance status', function () {
      assert.deepEqual(this.adminApi.getBalanceStatus(), {
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
    it('returns the collected stats', function () {
      assert.deepEqual(this.adminApi.getStats(), {
        counters: {
          'stats/incomingData/test.usd-ledger/fulfilled': 100,
          'stats/outgoingData/test.eur-ledger/fulfilled': 94
        },
        meters: {
          'stats/incomingData/test.usd-ledger/fulfilled': 1,
          'stats/outgoingData/test.eur-ledger/fulfilled': 1
        }
      })
    })
  })
})
