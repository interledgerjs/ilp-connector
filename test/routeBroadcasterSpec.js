'use strict'

const assert = require('assert')
const RoutingTables = require('five-bells-connector')._test.RoutingTables
const RouteBroadcaster = require('five-bells-connector')._test.RouteBroadcaster
const nock = require('nock')

const ledgerA = 'http://ledgerA.example'
const ledgerB = 'http://ledgerB.example'
const ledgerC = 'http://ledgerC.example'
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
      points: [ [0, 0], [200, 100] ]
    }, {
      source_ledger: ledgerB,
      destination_ledger: ledgerA,
      connector: baseURI,
      min_message_window: 1,
      source_account: ledgerB + '/accounts/mark',
      destination_account: ledgerA + '/accounts/mark',
      points: [ [0, 0], [100, 200] ]
    }])

    this.broadcaster = new RouteBroadcaster(this.tables, this.backend, {
      ledgerCredentials: {
        'http://ledgerA.example': {account_uri: ledgerA + '/accounts/mark'},
        'http://ledgerB.example': {account_uri: ledgerB + '/accounts/mark'}
      },
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
      points: [ [0, 0], [50, 60] ]
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

      nock('http://other-connector2.example').post('/routes', [
        {
          source_ledger: 'http://ledgerA.example',
          destination_ledger: 'http://ledgerB.example',
          connector: 'http://connector.example',
          min_message_window: 1,
          source_account: 'http://ledgerA.example/accounts/mark',
          points: [ [0, 0], [200, 100] ]
        }, {
          source_ledger: 'http://ledgerA.example',
          destination_ledger: 'http://ledgerC.example',
          connector: 'http://connector.example',
          min_message_window: 2,
          source_account: 'http://ledgerA.example/accounts/mark',
          points: [ [0, 0], [100, 60], [200, 60] ]
        }, {
          source_ledger: 'http://ledgerB.example',
          destination_ledger: 'http://ledgerA.example',
          connector: 'http://connector.example',
          min_message_window: 1,
          source_account: 'http://ledgerB.example/accounts/mark',
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
          connector: 'http://connector.example',
          min_message_window: 1,
          source_account: ledgerA + '/accounts/mark',
          destination_account: ledgerB + '/accounts/mark',
          points: [ [0, 0], [123, 456] ]
        })
    })
  })
})
