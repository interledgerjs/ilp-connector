'use strict'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const assert = require('assert')
const routing = require('ilp-routing')
const RoutingTables = require('../src/lib/routing-tables')
const RouteBroadcaster = require('../src/lib/route-broadcaster')
const Ledgers = require('../src/lib/ledgers')
const log = require('../src/common').log
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const ratesResponse = require('./data/fxRates.json')

const ledgerA = 'cad-ledger.'
const ledgerB = 'usd-ledger.'
const ledgerC = 'eur-ledger.'

describe('RouteBroadcaster', function () {
  logHelper(logger)

  beforeEach(function * () {
    process.env.BACKEND = 'one-to-one'
    appHelper.create(this)

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

    yield this.backend.connect(ratesResponse)

    this.tables = new RoutingTables({
      fxSpread: 0.002,
      slippage: 0.001
    })

    this.ledgers = new Ledgers({
      config: this.config,
      routingTables: this.tables,
      log
    })
    this.ledgers.addFromCredentialsConfig(ledgerCredentials)
    this.ledgers.getPlugin(ledgerA).getInfo =
    this.ledgers.getPlugin(ledgerB).getInfo =
      function () { return {precision: 10, scale: 2} }

    this.tables.addLocalRoutes(this.ledgers, [{
      source_ledger: ledgerA,
      destination_ledger: ledgerB,
      min_message_window: 1,
      source_account: ledgerA + 'mark',
      destination_account: ledgerB + 'mark',
      points: [ [0, 0], [200, 100] ],
      additional_info: {},
      destination_precision: 10,
      destination_scale: 2
    }, {
      source_ledger: ledgerB,
      destination_ledger: ledgerA,
      min_message_window: 1,
      source_account: ledgerB + 'mark',
      destination_account: ledgerA + 'mark',
      points: [ [0, 0], [100, 200] ],
      additional_info: {},
      destination_precision: 10,
      destination_scale: 2
    }])

    this.broadcaster = new RouteBroadcaster(this.tables, this.backend, this.ledgers, {
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
      additional_info: {},
      destination_precision: 10,
      destination_scale: 2
    })
  })

  afterEach(function () {
    delete process.env.BACKEND
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
    const routesFromA = [
      {
        source_ledger: ledgerA,
        destination_ledger: ledgerB,
        min_message_window: 1,
        source_account: ledgerA + 'mark',
        points: [ [0, -0.01], [200, 99.99] ],
        destination_precision: 10,
        destination_scale: 2
      }, {
        source_ledger: ledgerA,
        destination_ledger: ledgerC,
        min_message_window: 2,
        source_account: ledgerA + 'mark',
        points: [ [0, 0], [0.02, 0], [100.02, 60], [200, 60] ],
        destination_precision: 10,
        destination_scale: 2
      }
    ]
    const routesFromB = [
      {
        source_ledger: ledgerB,
        destination_ledger: ledgerA,
        min_message_window: 1,
        source_account: ledgerB + 'mark',
        points: [ [0, -0.01], [100, 199.99] ],
        destination_precision: 10,
        destination_scale: 2
      }
    ]

    it('sends the combined routes to all adjacent connectors', function * () {
      this.ledgers.getPlugin(ledgerA).getInfo =
        function () {
          return {
            prefix: ledgerA,
            connectors: [ledgerA + 'mark', ledgerA + 'mary'],
            precision: 10,
            scale: 2
          }
        }
      this.ledgers.getPlugin(ledgerB).getInfo =
        function () {
          return {
            prefix: ledgerB,
            connectors: [ledgerB + 'mark', ledgerB + 'mary'],
            precision: 10,
            scale: 2
          }
        }
      this.ledgers.getPlugin(ledgerC).getInfo =
        function () {
          return {
            prefix: ledgerC,
            connectors: [ledgerC + 'mark'],
            precision: 10,
            scale: 2
          }
        }

      let routesFromASent, routesFromBSent
      this.ledgers.getPlugin(ledgerA).sendMessage = function (message) {
        assert.deepEqual(message, {
          ledger: ledgerA,
          account: ledgerA + 'mary',
          data: { method: 'broadcast_routes', data: routesFromA }
        })
        routesFromASent = true
        return Promise.resolve(null)
      }

      this.ledgers.getPlugin(ledgerB).sendMessage = function (message) {
        assert.deepEqual(message, {
          ledger: ledgerB,
          account: ledgerB + 'mary',
          data: { method: 'broadcast_routes', data: routesFromB }
        })
        routesFromBSent = true
        return Promise.resolve(null)
      }

      yield this.broadcaster.crawl()
      this.broadcaster.broadcast()
      assert(routesFromASent)
      assert(routesFromBSent)
    })

    it('should send all routes even if sending one message fails', function * () {
      this.ledgers.getPlugin(ledgerA).getInfo =
        function () {
          return { prefix: ledgerA, connectors: [ledgerA + 'mark', ledgerA + 'mary'] }
        }
      this.ledgers.getPlugin(ledgerB).getInfo =
        function () {
          return { prefix: ledgerB, connectors: [ledgerB + 'mark', ledgerB + 'mary'] }
        }
      this.ledgers.getPlugin(ledgerC).getInfo =
        function () {
          return { prefix: ledgerC, connectors: [ledgerC + 'mark'] }
        }

      let routesFromASent, routesFromBSent
      this.ledgers.getPlugin(ledgerA).sendMessage = function (message) {
        routesFromASent = true
        return Promise.reject(new Error('something went wrong but the connector should continue anyway'))
      }
      this.ledgers.getPlugin(ledgerB).sendMessage = function (message) {
        routesFromBSent = true
        return Promise.resolve(null)
      }

      yield this.broadcaster.crawl()
      this.broadcaster.broadcast()
      assert(routesFromASent)
      assert(routesFromBSent)
    })

    it('should send all routes even if plugin.sendMessage hangs', function * () {
      this.ledgers.getPlugin(ledgerA).getInfo =
        function () {
          return { prefix: ledgerA, connectors: [ledgerA + 'mark', ledgerA + 'mary'] }
        }
      this.ledgers.getPlugin(ledgerB).getInfo =
        function () {
          return { prefix: ledgerB, connectors: [ledgerB + 'mark', ledgerB + 'mary'] }
        }
      this.ledgers.getPlugin(ledgerC).getInfo =
        function () {
          return { prefix: ledgerC, connectors: [ledgerC + 'mark'] }
        }

      let routesFromASent, routesFromBSent
      this.ledgers.getPlugin(ledgerA).sendMessage = function (message) {
        routesFromASent = true
        return new Promise((resolve) => {
          setTimeout(resolve, 1000000)
        })
      }
      this.ledgers.getPlugin(ledgerB).sendMessage = function (message) {
        routesFromBSent = true
        return Promise.resolve(null)
      }

      yield this.broadcaster.crawl()
      this.broadcaster.broadcast()
      assert(routesFromASent)
      assert(routesFromBSent)
    })
  })

  describe('_tradingPairToLocalRoute', function () {
    it('returns a Route', function * () {
      const route = yield this.broadcaster._tradingPairToLocalRoute(
        [ 'CAD@' + ledgerA, 'USD@' + ledgerB ])
      assert.ok(route instanceof routing.Route)
      assert.deepEqual(route.hops, [ledgerA, ledgerB])
      assert.deepEqual(route.sourceLedger, ledgerA)
      assert.deepEqual(route.destinationLedger, ledgerB)
      assert.deepEqual(route.sourceAccount, ledgerA + 'mark')
      assert.deepEqual(route.destinationAccount, ledgerB + 'mark')
      assert.deepEqual(route.getPoints(), [ [0, 0], [100000000, 77823868.07038209] ])
    })
  })
})

function assertSubset (actual, expect) {
  for (const key in expect) {
    assert.deepStrictEqual(actual[key], expect[key])
  }
}
