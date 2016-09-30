'use strict'

const assert = require('assert')
const routing = require('five-bells-routing')
const RoutingTables = require('../src/lib/routing-tables')
const RouteBroadcaster = require('ilp-connector')._test.RouteBroadcaster
const nock = require('nock')
const appHelper = require('./helpers/app')

const ledgerA = 'cad-ledger.'
const ledgerB = 'usd-ledger.'
const ledgerC = 'eur-ledger.'
const baseURI = 'http://connector.example'

describe('RouteBroadcaster', function () {
  beforeEach(function * () {
    appHelper.create(this)

    this.infoCache = {
      get: function * (ledger) {
        return {precision: 10, scale: 2}
      }
    }

    this.tables = new RoutingTables({
      baseURI: baseURI,
      fxSpread: 0.002,
      slippage: 0.001
    })
    yield this.tables.addLocalRoutes(this.infoCache, [{
      source_ledger: ledgerA,
      destination_ledger: ledgerB,
      connector: baseURI,
      min_message_window: 1,
      source_account: ledgerA + 'mark',
      destination_account: ledgerB + 'mark',
      points: [ [0, 0], [200, 100] ],
      additional_info: {}
    }, {
      source_ledger: ledgerB,
      destination_ledger: ledgerA,
      connector: baseURI,
      min_message_window: 1,
      source_account: ledgerB + 'mark',
      destination_account: ledgerA + 'mark',
      points: [ [0, 0], [100, 200] ],
      additional_info: {}
    }])

    this.broadcaster = new RouteBroadcaster(this.tables, this.backend, this.core, this.infoCache, {
      tradingPairs: [
        ['USD@' + ledgerA, 'EUR@' + ledgerB],
        ['EUR@' + ledgerB, 'USD@' + ledgerA]
      ],
      minMessageWindow: 1,
      autoloadPeers: true,
      peers: []
    })

    this.tables.addRoute({
      source_ledger: ledgerB,
      destination_ledger: ledgerC,
      connector: 'http://other-connector2.example',
      min_message_window: 1,
      points: [ [0, 0], [50, 60] ],
      additional_info: {}
    })
  })

  afterEach(function * () { assert(nock.isDone()) })

  describe('broadcast', function () {
    it('sends the combined routes to all adjacent connectors', function * () {
      this.core.getPlugin(ledgerA).getInfo =
      this.core.getPlugin(ledgerC).getInfo =
        function () {
          return Promise.resolve({ connectors: [{connector: baseURI}] })
        }
      this.core.getPlugin(ledgerB).getInfo =
        function () {
          return Promise.resolve({
            connectors: [
              {connector: baseURI},
              {connector: 'http://other-connector2.example'}
            ]
          })
        }

      nock('http://other-connector2.example').post('/routes', [
        {
          source_ledger: ledgerA,
          destination_ledger: ledgerC,
          connector: 'http://connector.example',
          min_message_window: 2,
          source_account: ledgerA + 'mark',
          points: [ [0, 0], [0.02, 0], [100.02, 60], [200, 60] ]
        }, {
          source_ledger: ledgerA,
          destination_ledger: ledgerB,
          connector: 'http://connector.example',
          min_message_window: 1,
          source_account: ledgerA + 'mark',
          points: [ [0, -0.01], [200, 99.99] ]
        }, {
          source_ledger: ledgerB,
          destination_ledger: ledgerA,
          connector: 'http://connector.example',
          min_message_window: 1,
          source_account: ledgerB + 'mark',
          points: [ [0, -0.01], [100, 199.99] ]
        }
      ]).reply(200)

      yield this.broadcaster.crawlLedgers()
      yield this.broadcaster.broadcast()
    })
  })

  it('should not throw an error even if the other connector does not respond', function * () {
    this.core.getPlugin(ledgerA).getInfo =
      this.core.getPlugin(ledgerC).getInfo =
      function () {
        return Promise.resolve({ connectors: [{connector: baseURI}] })
      }
    this.core.getPlugin(ledgerB).getInfo =
      function () {
        return Promise.resolve({
          connectors: [
            {connector: baseURI},
            {connector: 'http://other-connector2.example'}
          ]
        })
      }

    nock('http://other-connector2.example').post('/routes').reply(404)

    yield this.broadcaster.crawlLedgers()
    yield this.broadcaster.broadcast()
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
