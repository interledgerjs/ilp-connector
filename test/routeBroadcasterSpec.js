'use strict'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const assert = require('assert')
const routing = require('ilp-routing')
const RoutingTables = require('../src/lib/routing-tables')
const RouteBroadcaster = require('ilp-connector')._test.RouteBroadcaster
const makeCore = require('../src/lib/core')
const log = require('../src/common').log
const appHelper = require('./helpers/app')

const ledgerA = 'cad-ledger.'
const ledgerB = 'usd-ledger.'
const ledgerC = 'eur-ledger.'

describe('RouteBroadcaster', function () {
  beforeEach(function * () {
    appHelper.create(this)

    this.infoCache = {
      get: function * (ledger) {
        return {precision: 10, scale: 2}
      }
    }

    const ledgerCredentials = {
      'cad-ledger.': {plugin: 'ilp-plugin-mock', options: {username: 'mark'}},
      'usd-ledger.': {plugin: 'ilp-plugin-mock', options: {username: 'mark'}},
      'eur-ledger.': {plugin: 'ilp-plugin-mock', options: {username: 'mark'}}
    }

    const configRoutes = [
      {
        targetPrefix: 'prefix.',
        connectorAccount: 'cad-ledger.mary',
        connectorLedger: 'cad-ledger.'
      }
    ]

    this.tables = new RoutingTables({
      fxSpread: 0.002,
      slippage: 0.001
    })
    yield this.tables.addLocalRoutes(this.infoCache, [{
      source_ledger: ledgerA,
      destination_ledger: ledgerB,
      min_message_window: 1,
      source_account: ledgerA + 'mark',
      destination_account: ledgerB + 'mark',
      points: [ [0, 0], [200, 100] ],
      additional_info: {}
    }, {
      source_ledger: ledgerB,
      destination_ledger: ledgerA,
      min_message_window: 1,
      source_account: ledgerB + 'mark',
      destination_account: ledgerA + 'mark',
      points: [ [0, 0], [100, 200] ],
      additional_info: {}
    }])

    this.core = makeCore({
      config: Object.assign({}, this.config, {ledgerCredentials}),
      routingTables: this.tables,
      log
    })

    this.broadcaster = new RouteBroadcaster(this.tables, this.backend, this.core, this.infoCache, {
      tradingPairs: [
        [ledgerA, ledgerB],
        [ledgerB, ledgerA]
      ],
      minMessageWindow: 1,
      autoloadPeers: true,
      peers: [],
      ledgerCredentials,
      configRoutes
    })

    this.tables.addRoute({
      source_ledger: ledgerB,
      destination_ledger: ledgerC,
      source_account: ledgerB + 'mary',
      min_message_window: 1,
      points: [ [0, 0], [50, 60] ],
      additional_info: {}
    })
  })

  describe('addConfigRoutes', function () {
    it('loads routes from CONNECTOR_ROUTES', function * () {
      yield this.broadcaster.addConfigRoutes()
      assertSubset(
        this.tables.localTables.sources.get(ledgerB).destinations.get('prefix.').get('cad-ledger.mary'),
        {
          sourceLedger: ledgerB,
          nextLedger: ledgerA,
          sourceAccount: 'usd-ledger.mark'
        })
    })
  })

  describe('broadcast', function () {
    const routes = [
      {
        source_ledger: ledgerA,
        destination_ledger: ledgerC,
        min_message_window: 2,
        source_account: ledgerA + 'mark',
        points: [ [0, 0], [0.02, 0], [100.02, 60], [200, 60] ]
      }, {
        source_ledger: ledgerA,
        destination_ledger: ledgerB,
        min_message_window: 1,
        source_account: ledgerA + 'mark',
        points: [ [0, -0.01], [200, 99.99] ]
      }, {
        source_ledger: ledgerB,
        destination_ledger: ledgerA,
        min_message_window: 1,
        source_account: ledgerB + 'mark',
        points: [ [0, -0.01], [100, 199.99] ]
      }
    ]

    it('sends the combined routes to all adjacent connectors', function * () {
      this.core.getPlugin(ledgerA).getInfo =
      this.core.getPlugin(ledgerC).getInfo =
        function () {
          return Promise.resolve({ connectors: [{name: 'mark'}] })
        }
      this.core.getPlugin(ledgerB).getInfo =
        function () {
          return Promise.resolve({ connectors: [{name: 'mark'}, {name: 'mary'}] })
        }

      let routesSent
      this.core.getPlugin(ledgerB).sendMessage = function (message) {
        assert.deepEqual(message, {
          ledger: ledgerB,
          account: ledgerB + 'mary',
          data: { method: 'broadcast_routes', data: routes }
        })
        routesSent = true
        return Promise.resolve(null)
      }

      yield this.broadcaster.crawl()
      yield this.broadcaster.broadcast()
      assert(routesSent)
    })

    it('should not throw an error even if the other connector does not respond', function * () {
      this.core.getPlugin(ledgerA).getInfo =
      this.core.getPlugin(ledgerC).getInfo =
        function () {
          return Promise.resolve({ connectors: [{name: 'mark'}] })
        }
      this.core.getPlugin(ledgerB).getInfo =
        function () {
          return Promise.resolve({ connectors: [{name: 'mark'}, {name: 'mary'}] })
        }

      let routesSent
      this.core.getPlugin(ledgerB).sendMessage = function (message) {
        assert.deepEqual(message, {
          ledger: ledgerB,
          account: ledgerB + 'mary',
          data: { method: 'broadcast_routes', data: routes }
        })
        routesSent = true
        return Promise.resolve(null)
      }

      yield this.broadcaster.crawl()
      yield this.broadcaster.broadcast()
      assert(routesSent)
    })
  })

  describe('_quoteToLocalRoute', function () {
    it('returns a Route', function * () {
      const route = yield this.broadcaster._quoteToLocalRoute({
        source_ledger: ledgerA,
        destination_ledger: ledgerB,
        source_amount: '123',
        destination_amount: '456'
      })
      assert.ok(route instanceof routing.Route)
      assert.deepEqual(route.hops, [ledgerA, ledgerB])
      assert.deepEqual(route.getPoints(), [ [0, 0], [123, 456] ])
    })
  })
})

function assertSubset (actual, expect) {
  for (const key in expect) {
    assert.deepStrictEqual(actual[key], expect[key])
  }
}
