'use strict'

const assert = require('assert')
const routing = require('five-bells-routing')
const RouteBroadcaster = require('five-bells-connector')._test.RouteBroadcaster
const nock = require('nock')
const appHelper = require('./helpers/app')

const ledgerA = 'cad-ledger.'
const ledgerB = 'usd-ledger.'
const ledgerC = 'eur-ledger.'
const ledgerD = 'cny-ledger.'
const baseURI = 'http://connector.example'

describe('RouteBroadcaster', function () {
  beforeEach(function * () {
    appHelper.create(this)

    this.tables = new routing.RoutingTables(baseURI, [{
      source_ledger: ledgerA,
      destination_ledger: ledgerB,
      connector: baseURI,
      min_message_window: 1,
      source_account: ledgerA + '.mark',
      destination_account: ledgerB + '.mark',
      points: [ [0, 0], [200, 100] ],
      additional_info: {}
    }, {
      source_ledger: ledgerB,
      destination_ledger: ledgerA,
      connector: baseURI,
      min_message_window: 1,
      source_account: ledgerB + '.mark',
      destination_account: ledgerA + '.mark',
      points: [ [0, 0], [100, 200] ],
      additional_info: {}
    }])

    this.infoCache = {
      get: function * (ledger) {
        return {precision: 10, scale: 2}
      }
    }

    this.broadcaster = new RouteBroadcaster(this.tables, this.backend, this.core, this.infoCache, {
      tradingPairs: [
        ['USD@' + ledgerA, 'EUR@' + ledgerB],
        ['EUR@' + ledgerB, 'USD@' + ledgerA]
      ],
      minMessageWindow: 1
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
      this.core.getPlugin(ledgerA).getConnectors =
      this.core.getPlugin(ledgerC).getConnectors =
      this.core.getPlugin(ledgerD).getConnectors =
        function * () { return [baseURI] }
      this.core.getPlugin(ledgerB).getConnectors =
        function * () { return [baseURI, 'http://other-connector2.example'] }

      nock('http://other-connector2.example').post('/routes', [
        {
          source_ledger: ledgerA,
          destination_ledger: ledgerB,
          connector: 'http://connector.example',
          min_message_window: 1,
          source_account: ledgerA + '.mark',
          points: [ [0, 0], [200, 100] ]
        }, {
          source_ledger: ledgerA,
          destination_ledger: ledgerC,
          connector: 'http://connector.example',
          min_message_window: 2,
          source_account: ledgerA + '.mark',
          points: [ [0, 0], [100, 60], [200, 60] ]
        }, {
          source_ledger: ledgerB,
          destination_ledger: ledgerA,
          connector: 'http://connector.example',
          min_message_window: 1,
          source_account: ledgerB + '.mark',
          points: [ [0, 0], [100, 200] ]
        }
      ]).reply(200)

      yield this.broadcaster.crawlLedgers()
      yield this.broadcaster.broadcast()
    })
  })

  describe('_quoteToLocalRoute', function () {
    it('returns a Route', function * () {
      const route = this.broadcaster._quoteToLocalRoute({
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
