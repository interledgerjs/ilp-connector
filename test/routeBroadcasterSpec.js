'use strict'

const assert = require('assert')
const RoutingTables = require('five-bells-connector')._test.RoutingTables
const RouteBroadcaster = require('five-bells-connector')._test.RouteBroadcaster
const nock = require('nock')

const ledgerA = 'http://cad-ledger.example:1000'
const ledgerB = 'http://usd-ledger.example'
const ledgerC = 'http://eur-ledger.example'
const ledgerD = 'http://cny-ledger.example'
const baseURI = 'http://connector.example'

describe('RouteBroadcaster', function () {
  beforeEach(function * () {
    this.tables = new RoutingTables(baseURI, [{
      source_ledger: ledgerA,
      destination_ledger: ledgerB,
      connector: baseURI,
      min_message_window: 1,
      source_account: ledgerA + '/accounts/mark',
      destination_account: ledgerB + '/accounts/mark',
      points: [ [0, 0], [200, 100] ],
      additional_info: {}
    }, {
      source_ledger: ledgerB,
      destination_ledger: ledgerA,
      connector: baseURI,
      min_message_window: 1,
      source_account: ledgerB + '/accounts/mark',
      destination_account: ledgerA + '/accounts/mark',
      points: [ [0, 0], [100, 200] ],
      additional_info: {}
    }])

    this.broadcaster = new RouteBroadcaster(this.tables, this.backend, this.ledgers, {
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
      nock(ledgerA).get('/connectors').reply(200, [{connector: baseURI}])
      nock(ledgerB).get('/connectors').reply(200, [
        {connector: baseURI},
        {connector: 'http://other-connector2.example'}
      ])
      nock(ledgerC).get('/connectors').reply(200, [{connector: baseURI}])
      nock(ledgerD).get('/connectors').reply(200, [{connector: baseURI}])

      nock('http://other-connector2.example').post('/routes', [
        {
          source_ledger: ledgerA,
          destination_ledger: ledgerB,
          connector: 'http://connector.example',
          min_message_window: 1,
          source_account: ledgerA + '/accounts/mark',
          points: [ [0, 0], [200, 100] ]
        }, {
          source_ledger: ledgerA,
          destination_ledger: ledgerC,
          connector: 'http://connector.example',
          min_message_window: 2,
          source_account: ledgerA + '/accounts/mark',
          points: [ [0, 0], [100, 60], [200, 60] ]
        }, {
          source_ledger: ledgerB,
          destination_ledger: ledgerA,
          connector: 'http://connector.example',
          min_message_window: 1,
          source_account: ledgerB + '/accounts/mark',
          points: [ [0, 0], [100, 200] ]
        }
      ]).reply(200)

      yield this.broadcaster.crawlLedgers()
      yield this.broadcaster.broadcast()
    })
  })

  describe('_quoteToLocalRoute', function () {
    it('returns a Route', function * () {
      assert.deepEqual(
        this.broadcaster._quoteToLocalRoute({
          source_ledger: ledgerA,
          destination_ledger: ledgerB,
          source_amount: '123',
          destination_amount: '456'
        }), {
          source_ledger: ledgerA,
          destination_ledger: ledgerB,
          additional_info: undefined,
          connector: 'http://connector.example',
          min_message_window: 1,
          source_account: ledgerA + '/accounts/mark',
          destination_account: ledgerB + '/accounts/mark',
          points: [ [0, 0], [123, 456] ]
        })
    })
  })
})
