'use strict'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const { cloneDeep } = require('lodash')
const { assert } = require('chai')
const LiquidityCurve = require('../src/routing/liquidity-curve').default
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')

const ledgerA = 'cad-ledger'
const ledgerB = 'usd-ledger'
const ledgerC = 'eur-ledger'

const env = cloneDeep(process.env)

describe('RouteBroadcaster', function () {
  logHelper(logger)

  beforeEach(async function () {
    // process.env.CONNECTOR_BACKEND = 'one-to-one'
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify({
      'cad-ledger': {
        relation: 'peer',
        assetCode: 'CAD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          username: 'mark'
        }
      },
      'usd-ledger': {
        relation: 'peer',
        assetCode: 'USD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          username: 'mark'
        }
      },
      'eur-ledger': {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          username: 'mark'
        }
      }
    })
    process.env.CONNECTOR_ROUTES = JSON.stringify([
      {
        targetPrefix: 'prefix',
        peerId: 'cad-ledger'
      }, {
        targetPrefix: 'eur-ledger',
        peerId: 'eur-ledger'
      }
    ])
    process.env.CONNECTOR_PEERS = JSON.stringify(['cad-ledger', 'usd-ledger'])
    appHelper.create(this)
    this.routeBroadcaster.reloadLocalRoutes()

    const testAccounts = ['cad-ledger', 'usd-ledger', 'eur-ledger']
    for (let accountId of testAccounts) {
      this.accounts.getPlugin(accountId)._dataHandler(Buffer.from(JSON.stringify({
        method: 'broadcast_routes',
        data: {
          hold_down_time: 45000,
          unreachable_through_me: [],
          request_full_table: false,
          new_routes: [{
            prefix: accountId,
            path: []
          }]
        }
      })))
    }
  })

  afterEach(function () {
    process.env = cloneDeep(env)
  })

  describe('add', function () {
    it('loads peers from CONNECTOR_PEERS if set', async function () {
      process.env.CONNECTOR_PEERS = JSON.stringify(['eur-ledger', 'usd-ledger'])
      appHelper.create(this)
      assert.ok(this.routeBroadcaster.peers.get('eur-ledger'))
      assert.ok(this.routeBroadcaster.peers.get('usd-ledger'))
      assert.notOk(this.routeBroadcaster.peers.get('cad-ledger'))
    })
  })

  describe('reloadLocalRoutes', function () {
    it('loads routes from CONNECTOR_ROUTES', async function () {
      assert.deepEqual(this.routingTable.resolve('prefix.mary'), {
        nextHop: 'cad-ledger',
        path: []
      })
    })

    it('prefers configured routes over local ones', async function () {
      process.env.CONNECTOR_ROUTES = JSON.stringify([{
        targetPrefix: 'cad-ledger',
        peerId: 'usd-ledger'
      }])
      appHelper.create(this)
      this.routeBroadcaster.reloadLocalRoutes()

      assert.equal(this.routingTable.resolve('cad-ledger.mary').nextHop, 'usd-ledger')
    })
  })

  describe('broadcast', function () {
    const routesWithSourceLedgerA = [
      {
        prefix: 'test.connie',
        path: []
      }, {
        prefix: ledgerB,
        path: []
      }, {
        prefix: ledgerC,
        path: []
      }
    ]
    const routesWithSourceLedgerB = [
      {
        prefix: 'test.connie',
        path: []
      },
      {
        prefix: ledgerC,
        path: []
      }, {
        prefix: ledgerA,
        path: []
      }, {
        prefix: 'prefix',
        path: []
      }
    ]

    it('sends the combined routes to all adjacent connectors', async function () {
      let ledgerABroadcast
      this.accounts.getPlugin(ledgerA).sendData = function (message) {
        ledgerABroadcast = JSON.parse(message.toString('utf8'))
        return Promise.resolve(null)
      }

      let ledgerBBroadcast
      this.accounts.getPlugin(ledgerB).sendData = function (message) {
        ledgerBBroadcast = JSON.parse(message.toString('utf8'))
        return Promise.resolve(null)
      }

      await this.routeBroadcaster.broadcast()
      assert.deepEqual(ledgerABroadcast, {
        custom: {
          method: 'broadcast_routes',
          data: {
            hold_down_time: 45000,
            unreachable_through_me: [],
            request_full_table: false,
            new_routes: routesWithSourceLedgerA
          }
        },
        timeout: 30000
      })
      assert.deepEqual(ledgerBBroadcast, {
        custom: {
          method: 'broadcast_routes',
          data: {
            hold_down_time: 45000,
            unreachable_through_me: [],
            request_full_table: false,
            new_routes: routesWithSourceLedgerB
          }
        },
        timeout: 30000
      })
    })

    it('invalidates routes', async function () {
      const ledgerD = 'xrp.ledger'
      const newRoutes = [{
        prefix: ledgerD,
        min_message_window: 1,
        points: new LiquidityCurve([ [0, 0], [50, 60] ]).toBuffer().toString('base64'),
        path: []
      }]
      assert.equal(this.routingTable.keys().length, 4)
      await this.ccpController.handle(ledgerB, {
        new_routes: newRoutes,
        hold_down_time: 1234,
        unreachable_through_me: [],
        request_full_table: false
      })
      assert.equal(this.routingTable.keys().length, 5)
      await this.ccpController.handle(ledgerB, {
        new_routes: [],
        hold_down_time: 1234,
        unreachable_through_me: [ledgerD],
        request_full_table: false
      })
      assert.equal(this.routingTable.keys().length, 4)
    })

    it('does not add peer routes', async function () {
      const newRoutes = [{
        prefix: 'peer.do.not.add.me',
        min_message_window: 1,
        points: new LiquidityCurve([ [0, 0], [50, 60] ]).toBuffer().toString('base64'),
        path: []
      }]
      assert.equal(this.routingTable.keys().length, 4)
      await this.ccpController.handle(ledgerB, {
        new_routes: newRoutes,
        hold_down_time: 1234,
        unreachable_through_me: [],
        request_full_table: false
      })
      assert.equal(this.routingTable.keys().length, 4)
    })

    it('should send all routes even if sending one message fails', async function () {
      this.accounts.getPlugin(ledgerA).getInfo =
        function () {
          return { prefix: ledgerA, connectors: [ledgerA + 'mark', ledgerA + 'mary'] }
        }
      this.accounts.getPlugin(ledgerB).getInfo =
        function () {
          return { prefix: ledgerB, connectors: [ledgerB + 'mark', ledgerB + 'mary'] }
        }
      this.accounts.getPlugin(ledgerC).getInfo =
        function () {
          return { prefix: ledgerC, connectors: [ledgerC + 'mark'] }
        }

      let routesWithSourceLedgerASent, routesWithSourceLedgerBSent
      this.accounts.getPlugin(ledgerA).sendData = function (message) {
        routesWithSourceLedgerASent = true
        return Promise.reject(new Error('something went wrong but the connector should continue anyway'))
      }
      this.accounts.getPlugin(ledgerB).sendData = function (message) {
        routesWithSourceLedgerBSent = true
        return Promise.resolve(null)
      }

      await this.routeBroadcaster.broadcast()
      assert(routesWithSourceLedgerASent)
      assert(routesWithSourceLedgerBSent)
    })

    it('should send all routes even if plugin.sendData hangs', async function () {
      let routesWithSourceLedgerASent, routesWithSourceLedgerBSent
      this.accounts.getPlugin(ledgerA).sendData = function (message) {
        routesWithSourceLedgerASent = true
        return new Promise(resolve => {})
      }
      this.accounts.getPlugin(ledgerB).sendData = function (message) {
        routesWithSourceLedgerBSent = true
        return Promise.resolve(null)
      }

      this.routeBroadcaster.config.routeBroadcastInterval = 20
      await this.routeBroadcaster.broadcast()
      assert(routesWithSourceLedgerASent)
      assert(routesWithSourceLedgerBSent)
    })
  })
})
