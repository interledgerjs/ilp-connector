'use strict'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const { cloneDeep } = require('lodash')
const { assert } = require('chai')
const LiquidityCurve = require('../src/routing/liquidity-curve')
const MessageRouter = require('../src/lib/message-router')
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
      'cad-ledger': {plugin: 'ilp-plugin-mock', options: {username: 'mark'}, currency: 'CAD'},
      'usd-ledger': {plugin: 'ilp-plugin-mock', options: {username: 'mark'}, currency: 'USD'},
      'eur-ledger': {plugin: 'ilp-plugin-mock', options: {username: 'mark'}, currency: 'EUR'}
    })
    process.env.CONNECTOR_ROUTES = JSON.stringify([
      {
        targetPrefix: 'prefix',
        peerAddress: 'cad-ledger'
      }
    ])
    process.env.CONNECTOR_PEERS = 'cad-ledger,usd-ledger'
    appHelper.create(this)
    this.routeBroadcaster.reloadLocalRoutes()
  })

  afterEach(function () {
    process.env = cloneDeep(env)
  })

  describe('add', function () {
    it('loads peers from CONNECTOR_PEERS if set', async function () {
      process.env.CONNECTOR_PEERS = ['eur-ledger', 'usd-ledger'].join(',')
      appHelper.create(this)
      assert.ok(this.routeBroadcaster.peers.get('eur-ledger'))
      assert.ok(this.routeBroadcaster.peers.get('usd-ledger'))
      assert.notOk(this.routeBroadcaster.peers.get('cad-ledger'))
    })
  })

  describe('reloadLocalRoutes', function () {
    it('loads routes from CONNECTOR_ROUTES', async function () {
      assert.equal(this.routingTable.resolve('prefix.mary'), 'cad-ledger')
    })

    it('prefers configured routes over local ones', async function () {
      process.env.CONNECTOR_ROUTES = JSON.stringify([{
        targetPrefix: 'cad-ledger',
        peerAddress: 'usd-ledger'
      }])
      appHelper.create(this)
      this.routeBroadcaster.reloadLocalRoutes()

      assert.equal(this.routingTable.resolve('cad-ledger.mary'), 'usd-ledger')
    })
  })

  describe('broadcast', function () {
    const routesWithSourceLedgerA = [
      {
        source_ledger: ledgerA,
        destination_ledger: ledgerB,
        min_message_window: 1,
        source_account: ledgerA,
        paths: [ [] ]
      }, {
        source_ledger: ledgerA,
        destination_ledger: ledgerC,
        min_message_window: 1,
        source_account: ledgerA,
        paths: [ [] ]
      }
    ]
    const routesWithSourceLedgerB = [
      {
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        min_message_window: 1,
        source_account: ledgerB,
        paths: [ [] ]
      }, {
        source_ledger: ledgerB,
        destination_ledger: ledgerA,
        min_message_window: 1,
        source_account: ledgerB,
        paths: [ [] ]
      }, {
        source_ledger: ledgerB,
        destination_ledger: 'prefix',
        min_message_window: 1,
        source_account: ledgerB,
        paths: [ [] ]
      }
    ]

    it('sends the combined routes to all adjacent connectors', async function () {
      let ledgerABroadcast
      this.accounts.getPlugin(ledgerA).sendRequest = function (message) {
        ledgerABroadcast = message
        return Promise.resolve(null)
      }

      let ledgerBBroadcast
      this.accounts.getPlugin(ledgerB).sendRequest = function (message) {
        ledgerBBroadcast = message
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
        source_ledger: ledgerB,
        destination_ledger: ledgerD,
        source_account: ledgerB,
        min_message_window: 1,
        points: new LiquidityCurve([ [0, 0], [50, 60] ]).toBuffer().toString('base64')
      }]
      assert.equal(this.routingTable.keys().length, 4)
      await this.messageRouter.receiveRoutes({
        new_routes: newRoutes,
        hold_down_time: 1234,
        unreachable_through_me: [],
        request_full_table: false
      }, ledgerB)
      assert.equal(this.routingTable.keys().length, 5)
      await this.messageRouter.receiveRoutes({
        new_routes: [],
        hold_down_time: 1234,
        unreachable_through_me: [ledgerD],
        request_full_table: false
      }, ledgerB)
      assert.equal(this.routingTable.keys().length, 4)
    })

    it('does not add peer routes', async function () {
      const newRoutes = [{
        source_ledger: ledgerB,
        destination_ledger: 'peer.do.not.add.me',
        source_account: ledgerB + 'mark',
        min_message_window: 1,
        points: new LiquidityCurve([ [0, 0], [50, 60] ]).toBuffer().toString('base64')
      }]
      assert.equal(this.routingTable.keys().length, 4)
      await this.messageRouter.receiveRoutes({
        new_routes: newRoutes,
        hold_down_time: 1234,
        unreachable_through_me: [],
        request_full_table: false
      }, ledgerB)
      assert.equal(this.routingTable.keys().length, 4)
    })

    it('ignores routes where source_ledger does not match source_account', async function () {
      const config = this.config
      const accounts = this.accounts
      const routingTables = this.tables
      const routeBroadcaster = this.routeBroadcaster
      const routeBuilder = this.routeBuilder
      const messageRouter = new MessageRouter({config, accounts, routingTables, routeBroadcaster, routeBuilder})
      const newRoutes = [{
        source_ledger: ledgerA,
        destination_ledger: 'alpha',
        source_account: ledgerB,
        min_message_window: 1,
        points: new LiquidityCurve([ [0, 0], [50, 60] ]).toBuffer().toString('base64')
      }]
      assert.equal(this.routingTable.keys().length, 4)
      await messageRouter.receiveRoutes({
        new_routes: newRoutes,
        hold_down_time: 1234,
        unreachable_through_me: [],
        request_full_table: false
      }, ledgerB)
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
      this.accounts.getPlugin(ledgerA).sendRequest = function (message) {
        routesWithSourceLedgerASent = true
        return Promise.reject(new Error('something went wrong but the connector should continue anyway'))
      }
      this.accounts.getPlugin(ledgerB).sendRequest = function (message) {
        routesWithSourceLedgerBSent = true
        return Promise.resolve(null)
      }

      await this.routeBroadcaster.broadcast()
      assert(routesWithSourceLedgerASent)
      assert(routesWithSourceLedgerBSent)
    })

    it('should send all routes even if plugin.sendRequest hangs', async function () {
      let routesWithSourceLedgerASent, routesWithSourceLedgerBSent
      this.accounts.getPlugin(ledgerA).sendRequest = function (message) {
        routesWithSourceLedgerASent = true
        return new Promise(resolve => {})
      }
      this.accounts.getPlugin(ledgerB).sendRequest = function (message) {
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
