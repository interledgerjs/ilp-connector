'use strict'

const sinon = require('sinon')
const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const { cloneDeep } = require('lodash')
const { assert } = require('chai')
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')

const ledgerA = 'test.cad-ledger'
const ledgerB = 'test.usd-ledger'
const ledgerC = 'test.eur-ledger'

const env = cloneDeep(process.env)

describe('RouteBroadcaster', function () {
  logHelper(logger)

  beforeEach(async function () {
    // process.env.CONNECTOR_BACKEND = 'one-to-one'
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify({
      'test.cad-ledger': {
        relation: 'peer',
        assetCode: 'CAD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          username: 'mark'
        }
      },
      'test.usd-ledger': {
        relation: 'peer',
        assetCode: 'USD',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          username: 'mark'
        }
      },
      'test.eur-ledger': {
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
        targetPrefix: 'test.prefix',
        peerId: 'test.cad-ledger'
      }, {
        targetPrefix: 'test.eur-ledger',
        peerId: 'test.eur-ledger'
      }
    ])
    process.env.CONNECTOR_PEERS = JSON.stringify(['test.cad-ledger', 'test.usd-ledger'])
    process.env.CONNECTOR_ROUTING_SECRET = 'c8rEzjyVRS7gGB3xLuy/GBDDKzZDPVJor/w6IA6pMfo='
    appHelper.create(this)
    this.routeBroadcaster.reloadLocalRoutes()
    await this.middlewareManager.setup()

    const testAccounts = ['test.cad-ledger', 'test.usd-ledger', 'test.eur-ledger']
    for (let accountId of testAccounts) {
      await this.accounts.getPlugin(accountId).connect()
      this.routeBroadcaster.add(accountId)
      this.accounts.getPlugin(accountId)._dataHandler(Buffer.from(JSON.stringify({
        method: 'broadcast_routes',
        data: {
          speaker: accountId,
          routing_table_id: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
          from_epoch: 0,
          to_epoch: 1,
          hold_down_time: 45000,
          withdrawn_routes: [],
          new_routes: [{
            prefix: accountId,
            path: [accountId],
            auth: 'RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk='
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
      const accounts = JSON.parse(process.env.CONNECTOR_ACCOUNTS)

      // On one ledger we disable sending only
      accounts['test.usd-ledger'].sendRoutes = false

      // For the other ledger we disable sending and receiving routes
      accounts['test.cad-ledger'].sendRoutes = false
      accounts['test.cad-ledger'].receiveRoutes = false
      process.env.CONNECTOR_ACCOUNTS = JSON.stringify(accounts)
      appHelper.create(this)
      Object.keys(accounts).forEach(key => this.routeBroadcaster.add(key))

      // By default, everything should be enabled
      assert.ok(this.routeBroadcaster.peers.get('test.eur-ledger').sendRoutes)
      assert.ok(this.routeBroadcaster.peers.get('test.eur-ledger').receiveRoutes)

      // On this ledger only receiving should be disabled
      assert.notOk(this.routeBroadcaster.peers.get('test.usd-ledger').sendRoutes)
      assert.ok(this.routeBroadcaster.peers.get('test.usd-ledger').receiveRoutes)

      // When sending and receiving is disabled, the peer should not even be
      // instantiated by the routing system.
      assert.notOk(this.routeBroadcaster.peers.get('test.cad-ledger'))
    })
  })

  describe('reloadLocalRoutes', function () {
    it('loads routes from CONNECTOR_ROUTES', async function () {
      assert.deepEqual(this.routingTable.resolve('test.prefix.mary'), {
        nextHop: 'test.cad-ledger',
        path: [],
        auth: Buffer.from('hHGPAri/SbpL0ghJDzPBnsHYniyfvDF6hDjo0lNMzIY=', 'base64')
      })
    })

    it('prefers configured routes over local ones', async function () {
      process.env.CONNECTOR_ROUTES = JSON.stringify([{
        targetPrefix: 'test.cad-ledger',
        peerId: 'test.usd-ledger'
      }])
      appHelper.create(this)
      this.routeBroadcaster.reloadLocalRoutes()

      assert.equal(this.routingTable.resolve('test.cad-ledger.mary').nextHop, 'test.usd-ledger')
    })
  })

  describe('broadcast', function () {
    const routesWithSourceLedgerA = [
      {
        prefix: 'test.connie',
        path: ['test.connie'],
        auth: 'muk4Yc9MJfF9JOiCVhwdG/+Iffhw+g7fUPjRJTef24o='
      }, {
        prefix: ledgerC,
        path: ['test.connie'],
        auth: 'pzvpeQd5hc2o53xnDqXfNKH3ghg9lb3b1bZb8N3Wzqk='
      }, {
        prefix: ledgerB,
        path: ['test.connie', 'test.usd-ledger'],
        auth: 'VpLK9Fmhx11TynRzmQTvnynGYc+tOwoShsJ5QW61/O8='
      }
    ]
    const routesWithSourceLedgerB = [
      {
        prefix: 'test.connie',
        path: ['test.connie'],
        auth: 'muk4Yc9MJfF9JOiCVhwdG/+Iffhw+g7fUPjRJTef24o='
      },
      {
        prefix: 'test.prefix',
        path: ['test.connie'],
        auth: '2mgQJ9MAIe91vuQ+PddM6j8DGfqOAu0PH8ni5n+8lTM='
      }, {
        prefix: ledgerC,
        path: ['test.connie'],
        auth: 'pzvpeQd5hc2o53xnDqXfNKH3ghg9lb3b1bZb8N3Wzqk='
      }, {
        prefix: ledgerA,
        path: ['test.connie', 'test.cad-ledger'],
        auth: 'VpLK9Fmhx11TynRzmQTvnynGYc+tOwoShsJ5QW61/O8='
      }
    ]

    it('sends the combined routes to all adjacent connectors', async function () {
      const pluginABroadcastSpy = sinon.stub(this.accounts.getPlugin(ledgerA), 'sendData')
        .resolves(Buffer.from('{}', 'ascii'))
      const pluginBBroadcastSpy = sinon.stub(this.accounts.getPlugin(ledgerB), 'sendData')
        .resolves(Buffer.from('{}', 'ascii'))

      this.routeBroadcaster.forwardingRoutingTable.routingTableId = '3b069822-a754-4e44-8a60-0f9f7084144d'
      await this.routeBroadcaster.peers.get(ledgerA).sendSingleRouteUpdate()
      await this.routeBroadcaster.peers.get(ledgerB).sendSingleRouteUpdate()

      sinon.assert.calledOnce(pluginABroadcastSpy)
      sinon.assert.calledWithMatch(pluginABroadcastSpy, sinon.match(packet => assert.deepEqual(JSON.parse(packet.toString('utf8')), {
        method: 'broadcast_routes',
        data: {
          speaker: 'test.connie',
          routing_table_id: '3b069822-a754-4e44-8a60-0f9f7084144d',
          from_epoch: 0,
          to_epoch: 5,
          hold_down_time: 45000,
          withdrawn_routes: [],
          new_routes: routesWithSourceLedgerA
        }
      }) || true))

      sinon.assert.calledOnce(pluginBBroadcastSpy)
      sinon.assert.calledWithMatch(pluginBBroadcastSpy, sinon.match(packet => assert.deepEqual(JSON.parse(packet.toString('utf8')), {
        method: 'broadcast_routes',
        data: {
          speaker: 'test.connie',
          routing_table_id: '3b069822-a754-4e44-8a60-0f9f7084144d',
          from_epoch: 0,
          to_epoch: 5,
          hold_down_time: 45000,
          withdrawn_routes: [],
          new_routes: routesWithSourceLedgerB
        }
      }) || true))
    })

    it('invalidates routes', async function () {
      const ledgerD = 'test.xrp-ledger'
      const newRoutes = [{
        prefix: ledgerD,
        path: [ledgerD],
        auth: 'K3nWc6mNsJh8n+mpON6CdS36U5K4FbsIzEAevsckcso='
      }]
      assert.equal(this.routingTable.keys().length, 5)
      await this.ccpController.handle({
        speaker: ledgerD,
        routing_table_id: '3b069822-a754-4e44-8a60-0f9f7084144d',
        from_epoch: 0,
        to_epoch: 1,
        new_routes: newRoutes,
        hold_down_time: 1234,
        withdrawn_routes: []
      }, ledgerB)
      assert.equal(this.routingTable.keys().length, 6)
      await this.ccpController.handle({
        speaker: ledgerD,
        routing_table_id: '3b069822-a754-4e44-8a60-0f9f7084144d',
        from_epoch: 1,
        to_epoch: 2,
        new_routes: [],
        hold_down_time: 1234,
        withdrawn_routes: [ledgerD]
      }, ledgerB)
      assert.equal(this.routingTable.keys().length, 5)
    })

    it('does not add peer routes', async function () {
      const peerAddress = 'peer.do.not.add.me'
      const newRoutes = [{
        prefix: peerAddress,
        path: [peerAddress],
        auth: 'K3nWc6mNsJh8n+mpON6CdS36U5K4FbsIzEAevsckcso='
      }]
      assert.equal(this.routingTable.keys().length, 5)
      await this.ccpController.handle({
        speaker: peerAddress,
        routing_table_id: '3b069822-a754-4e44-8a60-0f9f7084144d',
        from_epoch: 0,
        to_epoch: 1,
        new_routes: newRoutes,
        hold_down_time: 1234,
        withdrawn_routes: []
      }, ledgerB)
      assert.equal(this.routingTable.keys().length, 5)
    })
  })
})
