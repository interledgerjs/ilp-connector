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

describe('RouteBroadcaster', function () {
  logHelper(logger)

  beforeEach(async function () {
    appHelper.create(this, {
      accounts: {
        'cad-ledger': {
          relation: 'peer',
          assetCode: 'CAD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock',
          options: { }
        },
        'usd-ledger': {
          relation: 'peer',
          assetCode: 'USD',
          assetScale: 4,
          plugin: 'ilp-plugin-mock',
          options: { }
        },
        'eur-ledger': {
          relation: 'peer',
          assetCode: 'EUR',
          assetScale: 4,
          plugin: 'ilp-plugin-mock',
          options: { }
        }
      },
      routes: [
        {targetPrefix: 'cad-ledger', peerId: 'cad-ledger'},
        {targetPrefix: 'usd-ledger', peerId: 'usd-ledger'},
        {targetPrefix: 'eur-ledger', peerId: 'eur-ledger'},
        {targetPrefix: 'cny-ledger', peerId: 'cny-ledger'}
      ],
    })
    await this.accounts.connect()
    this.routeBroadcaster.reloadLocalRoutes()
    await this.middlewareManager.setup()

    const testAccounts = ['cad-ledger', 'usd-ledger', 'eur-ledger']
    for (let accountId of testAccounts) {
      this.accounts.getPlugin(accountId)._dataHandler(Buffer.from(JSON.stringify({
        method: 'broadcast_routes',
        data: {
          speaker: accountId,
          routing_table_id: 'bc1ddf0e-1156-4277-bdf0-a75974e37dbe',
          hold_down_time: 45000,
          from_epoch: 0,
          to_epoch: 1,
          new_routes: [{prefix: accountId, path: []}],
          withdrawn_routes: []
        }
      })))
    }
  })

  describe('add', function () {
    it('loads sendRoutes/receiverRoutes from account info', async function () {
      const {accounts} = this.config

      // On one ledger we disable sending only
      accounts['usd-ledger'].sendRoutes = false

      // For the other ledger we disable sending and receiving routes
      accounts['cad-ledger'].sendRoutes = false
      accounts['cad-ledger'].receiveRoutes = false
      appHelper.create(this, {accounts})

      // By default, everything should be enabled
      assert.ok(this.routeBroadcaster.peers.get('eur-ledger').sendRoutes)
      assert.ok(this.routeBroadcaster.peers.get('eur-ledger').receiveRoutes)

      // On this ledger only receiving should be disabled
      assert.notOk(this.routeBroadcaster.peers.get('usd-ledger').sendRoutes)
      assert.ok(this.routeBroadcaster.peers.get('usd-ledger').receiveRoutes)

      // When sending and receiving is disabled, the peer should not even be
      // instantiated by the routing system.
      assert.notOk(this.routeBroadcaster.peers.get('cad-ledger'))
    })
  })

  describe('reloadLocalRoutes', function () {
    it('loads routes from config.routes', async function () {
      assert.deepEqual(this.routingTable.resolve('cad-ledger.mary'), {
        nextHop: 'cad-ledger',
        path: []
      })
    })

    it('prefers configured routes over local ones', async function () {
      appHelper.create(this, {
        routes: [{ targetPrefix: 'cad-ledger', peerId: 'usd-ledger' }]
      })
      this.routeBroadcaster.reloadLocalRoutes()

      assert.equal(this.routingTable.resolve('cad-ledger.mary').nextHop, 'usd-ledger')
    })
  })

  describe('sendRouteUpdate', function () {
    const routesWithSourceLedgerA = [
      { epoch: 1, nextHop: 'usd-ledger', path: [], prefix: 'usd-ledger' },
      { epoch: 2, nextHop: 'eur-ledger', path: [], prefix: 'eur-ledger' },
      { epoch: 3, nextHop: 'cny-ledger', path: [], prefix: 'cny-ledger' },
      // TODO should the connector send this?
      { epoch: 4, nextHop: '', path: [ 'test.connie' ], prefix: 'test.connie' }
    ]

    it('sends the combined routes to the adjacent connector', async function () {
      const broadcastPromise = new Promise((resolve) => {
        this.accounts.getPlugin(ledgerA).sendData = function (message) {
          resolve(JSON.parse(message.toString('utf8')))
          return Promise.resolve(null)
        }
      })

      await this.routeBroadcaster.sendRouteUpdate(ledgerA)
      const broadcast = await broadcastPromise
      assert.deepEqual(broadcast, {
        method: 'broadcast_routes',
        data: {
          speaker: 'test.connie',
          routing_table_id: broadcast.data.routing_table_id,
          hold_down_time: 45000,
          from_epoch: 1,
          to_epoch: 5,
          new_routes: routesWithSourceLedgerA,
          withdrawn_routes: []
        }
      })
    })

    it('invalidates routes', async function () {
      const ledgerD = 'test.xrp.ledger'
      assert.equal(this.routingTable.keys().length, 4)
      await this.ccpController.handle({
        speaker: 'test.connie',
        routing_table_id: 'bc1ddf0e-1156-4277-bdf0-a75974e37dbe',
        hold_down_time: 1234,
        from_epoch: 1,
        to_epoch: 2,
        new_routes: [{ prefix: ledgerD, path: [] }],
        withdrawn_routes: []
      }, ledgerB)
      assert.equal(this.routingTable.keys().length, 5)
      await this.ccpController.handle({
        speaker: 'test.connie',
        routing_table_id: 'bc1ddf0e-1156-4277-bdf0-a75974e37dbe',
        hold_down_time: 1234,
        from_epoch: 2,
        to_epoch: 3,
        new_routes: [],
        withdrawn_routes: [ledgerD]
      }, ledgerB)
      assert.equal(this.routingTable.keys().length, 4)
    })

    it('does not add peer routes', async function () {
      assert.equal(this.routingTable.keys().length, 4)
      await this.ccpController.handle({
        speaker: 'test.connie',
        routing_table_id: 'bc1ddf0e-1156-4277-bdf0-a75974e37dbe',
        hold_down_time: 1234,
        from_epoch: 2,
        to_epoch: 3,
        new_routes: [{prefix: 'peer.do.not.add.me', path: []}],
        withdrawn_routes: []
      }, ledgerB)
      assert.equal(this.routingTable.keys().length, 4)
    })
  })
})
