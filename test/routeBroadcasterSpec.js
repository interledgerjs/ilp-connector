'use strict'

const assert = require('assert')
const routing = require('five-bells-routing')
const RoutingTables = require('five-bells-connector')._test.RoutingTables
const RouteBroadcaster = require('five-bells-connector')._test.RouteBroadcaster
const nock = require('nock')

const ledgerA = 'http://ledgerA.example'
const ledgerB = 'http://ledgerB.example'
const ledgerC = 'http://ledgerC.example'
const baseURI = 'http://connector.example'
const pairs = [ [ledgerA, ledgerB], [ledgerB, ledgerA] ]

describe('RouteBroadcaster', function () {
  beforeEach(function * () {
    this.tables = new RoutingTables(baseURI, pairs, {
      'http://ledgerA.example;http://ledgerB.example': [ [0, 0], [200, 100] ],
      'http://ledgerB.example;http://ledgerA.example': [ [0, 0], [100, 200] ]
    })

    this.broadcaster = new RouteBroadcaster(baseURI, pairs, this.tables)

    this.tables.addRoute(ledgerB, ledgerC, 'http://other-connector2.example',
      new routing.Route([ [0, 0], [50, 60] ]))
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
          points: [ [0, 0], [200, 100] ]
        }, {
          source_ledger: 'http://ledgerA.example',
          destination_ledger: 'http://ledgerC.example',
          connector: 'http://connector.example',
          points: [ [0, 0], [0, 0], [100, 60], [200, 60] ]
        }, {
          source_ledger: 'http://ledgerB.example',
          destination_ledger: 'http://ledgerA.example',
          connector: 'http://connector.example',
          points: [ [0, 0], [100, 200] ]
        }, {
          source_ledger: 'http://ledgerB.example',
          destination_ledger: 'http://ledgerC.example',
          connector: 'http://connector.example',
          points: [ [0, 0], [50, 60] ]
        }
      ]).reply(200)

      yield this.broadcaster.crawlLedgers()
      yield this.broadcaster.broadcast()
    })
  })
})
