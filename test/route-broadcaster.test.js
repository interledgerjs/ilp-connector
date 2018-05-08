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
const {
  serializeCcpRouteUpdateRequest,
  deserializeCcpRouteUpdateRequest
} = require('ilp-protocol-ccp')

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
    await this.accounts.connect()

    const testAccounts = ['test.cad-ledger', 'test.usd-ledger', 'test.eur-ledger']
    for (let accountId of testAccounts) {
      await this.accounts.getPlugin(accountId).connect()
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
      await this.accounts.connect()
      Object.keys(accounts).forEach(key => this.routeBroadcaster.add(key))

      // By default, everything should be enabled
      assert.ok(this.routeBroadcaster.peers.get('test.eur-ledger').ccpSender)
      assert.ok(this.routeBroadcaster.peers.get('test.eur-ledger').ccpReceiver)

      // On this ledger only receiving should be disabled
      assert.notOk(this.routeBroadcaster.peers.get('test.usd-ledger').ccpSender)
      assert.ok(this.routeBroadcaster.peers.get('test.usd-ledger').ccpReceiver)

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
        auth: Buffer.from('muk4Yc9MJfF9JOiCVhwdG/+Iffhw+g7fUPjRJTef24o=', 'base64'),
        props: []
      }, {
        prefix: ledgerC,
        path: ['test.connie'],
        auth: Buffer.from('pzvpeQd5hc2o53xnDqXfNKH3ghg9lb3b1bZb8N3Wzqk=', 'base64'),
        props: []
      }, {
        prefix: ledgerB,
        path: ['test.connie', 'test.usd-ledger'],
        auth: Buffer.from('VpLK9Fmhx11TynRzmQTvnynGYc+tOwoShsJ5QW61/O8=', 'base64'),
        props: []
      }
    ]
    const routesWithSourceLedgerB = [
      {
        prefix: 'test.connie',
        path: ['test.connie'],
        auth: Buffer.from('muk4Yc9MJfF9JOiCVhwdG/+Iffhw+g7fUPjRJTef24o=', 'base64'),
        props: []
      },
      {
        prefix: 'test.prefix',
        path: ['test.connie'],
        auth: Buffer.from('2mgQJ9MAIe91vuQ+PddM6j8DGfqOAu0PH8ni5n+8lTM=', 'base64'),
        props: []
      }, {
        prefix: ledgerC,
        path: ['test.connie'],
        auth: Buffer.from('pzvpeQd5hc2o53xnDqXfNKH3ghg9lb3b1bZb8N3Wzqk=', 'base64'),
        props: []
      }, {
        prefix: ledgerA,
        path: ['test.connie', 'test.cad-ledger'],
        auth: Buffer.from('VpLK9Fmhx11TynRzmQTvnynGYc+tOwoShsJ5QW61/O8=', 'base64'),
        props: []
      }
    ]

    it('sends the combined routes to all adjacent connectors', async function () {
      const pluginABroadcastSpy = sinon.stub(this.accounts.getPlugin(ledgerA), 'sendData')
        .resolves(Buffer.from('{}', 'ascii'))
      const pluginBBroadcastSpy = sinon.stub(this.accounts.getPlugin(ledgerB), 'sendData')
        .resolves(Buffer.from('{}', 'ascii'))

      this.routeBroadcaster.forwardingRoutingTable.routingTableId = '3b069822-a754-4e44-8a60-0f9f7084144d'
      await this.routeBroadcaster.peers.get(ledgerA).ccpSender.sendSingleRouteUpdate()
      await this.routeBroadcaster.peers.get(ledgerB).ccpSender.sendSingleRouteUpdate()

      sinon.assert.calledOnce(pluginABroadcastSpy)
      sinon.assert.calledWithMatch(pluginABroadcastSpy, sinon.match(packet => assert.deepEqual(deserializeCcpRouteUpdateRequest(packet), {
        speaker: 'test.connie',
        routingTableId: '3b069822-a754-4e44-8a60-0f9f7084144d',
        currentEpochIndex: 5,
        fromEpochIndex: 0,
        toEpochIndex: 5,
        holdDownTime: 45000,
        withdrawnRoutes: [
          'test.prefix',
          'test.cad-ledger'
        ],
        newRoutes: routesWithSourceLedgerA
      }) || true))

      sinon.assert.calledOnce(pluginBBroadcastSpy)
      sinon.assert.calledWithMatch(pluginBBroadcastSpy, sinon.match(packet => assert.deepEqual(deserializeCcpRouteUpdateRequest(packet), {
        speaker: 'test.connie',
        routingTableId: '3b069822-a754-4e44-8a60-0f9f7084144d',
        currentEpochIndex: 5,
        fromEpochIndex: 0,
        toEpochIndex: 5,
        holdDownTime: 45000,
        withdrawnRoutes: [
          'test.usd-ledger'
        ],
        newRoutes: routesWithSourceLedgerB
      }) || true))
    })

    it('only sends the latest version of a route', async function () {
      const pluginABroadcastSpy = sinon.stub(this.accounts.getPlugin(ledgerA), 'sendData')
        .resolves(Buffer.from('{}', 'ascii'))
      const pluginBBroadcastSpy = sinon.stub(this.accounts.getPlugin(ledgerB), 'sendData')
        .resolves(Buffer.from('{}', 'ascii'))

      this.routeBroadcaster.forwardingRoutingTable.routingTableId = '3b069822-a754-4e44-8a60-0f9f7084144d'
      await this.routeBroadcaster.peers.get(ledgerA).ccpSender.sendSingleRouteUpdate()

      sinon.assert.calledOnce(pluginABroadcastSpy)
      sinon.assert.calledWithMatch(pluginABroadcastSpy, sinon.match(packet => assert.deepEqual(deserializeCcpRouteUpdateRequest(packet), {
        speaker: 'test.connie',
        routingTableId: '3b069822-a754-4e44-8a60-0f9f7084144d',
        currentEpochIndex: 5,
        fromEpochIndex: 0,
        toEpochIndex: 5,
        holdDownTime: 45000,
        withdrawnRoutes: [
          'test.prefix',
          'test.cad-ledger'
        ],
        newRoutes: routesWithSourceLedgerA
      }) || true))

      await this.routeBroadcaster.handleRouteUpdate(ledgerA, {
        speaker: ledgerA,
        routingTableId: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
        currentEpochIndex: 2,
        fromEpochIndex: 1,
        toEpochIndex: 2,
        newRoutes: [],
        holdDownTime: 1234,
        withdrawnRoutes: ['test.cad-ledger']
      })

      await this.routeBroadcaster.peers.get(ledgerB).ccpSender.sendSingleRouteUpdate()

      sinon.assert.calledOnce(pluginBBroadcastSpy)
      sinon.assert.calledWithMatch(pluginBBroadcastSpy, sinon.match(packet => assert.deepEqual(deserializeCcpRouteUpdateRequest(packet), {
        speaker: 'test.connie',
        routingTableId: '3b069822-a754-4e44-8a60-0f9f7084144d',
        currentEpochIndex: 6,
        fromEpochIndex: 0,
        toEpochIndex: 6,
        holdDownTime: 45000,
        withdrawnRoutes: [
          'test.usd-ledger',
          'test.cad-ledger'
        ],
        newRoutes: routesWithSourceLedgerB.filter(r => r.prefix !== 'test.cad-ledger')
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
      await this.routeBroadcaster.handleRouteUpdate(ledgerB, {
        speaker: ledgerD,
        routingTableId: '3b069822-a754-4e44-8a60-0f9f7084144d',
        currentEpochIndex: 1,
        fromEpochIndex: 0,
        toEpochIndex: 1,
        newRoutes: newRoutes,
        holdDownTime: 1234,
        withdrawnRoutes: []
      })
      assert.equal(this.routingTable.keys().length, 6)
      await this.routeBroadcaster.handleRouteUpdate(ledgerB, {
        speaker: ledgerD,
        routingTableId: '3b069822-a754-4e44-8a60-0f9f7084144d',
        currentEpochIndex: 2,
        fromEpochIndex: 1,
        toEpochIndex: 2,
        newRoutes: [],
        holdDownTime: 1234,
        withdrawnRoutes: [ledgerD]
      })
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
      await this.routeBroadcaster.handleRouteUpdate(ledgerB, {
        speaker: peerAddress,
        routingTableId: '3b069822-a754-4e44-8a60-0f9f7084144d',
        currentEpochIndex: 1,
        fromEpochIndex: 0,
        toEpochIndex: 1,
        newRoutes: newRoutes,
        holdDownTime: 1234,
        withdrawnRoutes: []
      })
      assert.equal(this.routingTable.keys().length, 5)
    })

    it('does not add routes that include own address in path because it would create a routing loop', async function () {
      const ledgerD = 'test.xrp-ledger'
      const newRoutes = [{
        prefix: ledgerD,
        path: [ledgerD, 'test.connie'],
        auth: 'K3nWc6mNsJh8n+mpON6CdS36U5K4FbsIzEAevsckcso='
      }]
      assert.equal(this.routingTable.keys().length, 5)
      await this.routeBroadcaster.handleRouteUpdate(ledgerB, {
        speaker: ledgerD,
        routingTableId: '3b069822-a754-4e44-8a60-0f9f7084144d',
        currentEpochIndex: 1,
        fromEpochIndex: 0,
        toEpochIndex: 1,
        newRoutes: newRoutes,
        holdDownTime: 1234,
        withdrawnRoutes: []
      })
      assert.equal(this.routingTable.keys().length, 5)
    })
  })
})
