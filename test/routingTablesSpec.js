'use strict'

const assert = require('assert')
const routing = require('five-bells-routing')
const RoutingTables = require('five-bells-connector')._test.RoutingTables
const sinon = require('sinon')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT
const ledgerA = 'http://ledgerA.example'
const ledgerB = 'http://ledgerB.example'
const ledgerC = 'http://ledgerC.example'

describe('RoutingTables', function () {
  beforeEach(function * () {
    this.clock = sinon.useFakeTimers(START_DATE)
    this.tables = new RoutingTables('http://connector.example', [
      [ledgerA, ledgerB],
      [ledgerB, ledgerA]
    ], {
      'http://ledgerA.example;http://ledgerB.example': [ [0, 0], [200, 100] ],
      'http://ledgerB.example;http://ledgerA.example': [ [0, 0], [100, 200] ]
    })
  })

  describe('findBestHopForSourceAmount', function () {
    it('finds the best next hop when there is one route', function * () {
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerB, 0),
        { bestHop: null, bestValue: 0 })
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerB, 100),
        { bestHop: 'http://connector.example', bestValue: 50 })
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerB, 200),
        { bestHop: 'http://connector.example', bestValue: 100 })
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerB, 300),
        { bestHop: 'http://connector.example', bestValue: 100 })
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerB, ledgerA, 100),
        { bestHop: 'http://connector.example', bestValue: 200 })
    })

    it('finds the best next hop when there are multiple hops', function * () {
      this.tables.addRoute(ledgerB, ledgerC, 'http://other-connector.example',
        new routing.Route([ [0, 0], [200, 100] ]))
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerC, 100),
        { bestHop: 'http://other-connector.example', bestValue: 25 })
    })

    it('finds the best next hop when there are multiple routes', function * () {
      this.tables.addRoute(ledgerB, ledgerC, 'http://other-connector.example',
        new routing.Route([ [0, 0], [50, 60] ]))
      this.tables.addRoute(ledgerB, ledgerC, 'http://other-connector2.example',
        new routing.Route([ [0, 0], [100, 100] ]))
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerC, 100),
        { bestHop: 'http://other-connector.example', bestValue: 60 })
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerC, 150),
        { bestHop: 'http://other-connector2.example', bestValue: 75 })
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerC, 200),
        { bestHop: 'http://other-connector2.example', bestValue: 100 })
    })

    it('allows overriding of local pair paths', function * () {
      this.tables.addRoute(ledgerA, ledgerB, 'http://other-connector.example',
        new routing.Route([ [0, 0], [50, 60] ]))
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerB, 100),
        { bestHop: 'http://other-connector.example', bestValue: 60 })
      assert.deepEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerB, 200),
        { bestHop: 'http://connector.example', bestValue: 100 })
    })
  })

  describe('findBestHopForDestinationAmount', function () {
    it('finds the best next hop when there is one route', function * () {
      assert.deepEqual(
        this.tables.findBestHopForDestinationAmount(ledgerA, ledgerB, 0),
        { bestHop: 'http://connector.example', bestCost: 0 })
      assert.deepEqual(
        this.tables.findBestHopForDestinationAmount(ledgerA, ledgerB, 50),
        { bestHop: 'http://connector.example', bestCost: 100 })
      assert.deepEqual(
        this.tables.findBestHopForDestinationAmount(ledgerA, ledgerB, 100),
        { bestHop: 'http://connector.example', bestCost: 200 })
      assert.deepEqual(
        this.tables.findBestHopForDestinationAmount(ledgerA, ledgerB, 150),
        { bestHop: null, bestCost: Infinity })
      assert.deepEqual(
        this.tables.findBestHopForDestinationAmount(ledgerB, ledgerA, 200),
        { bestHop: 'http://connector.example', bestCost: 100 })
    })
  })

  describe('removeExpiredRoutes', function () {
    it('expires old routes', function * () {
      this.tables.addRoute(ledgerB, ledgerC, 'http://other-connector.example',
        new routing.Route([ [0, 0], [50, 60] ]))

      // expire nothing
      assert.equal(this.tables.toJSON().length, 4)
      this.tables.removeExpiredRoutes()
      assert.equal(this.tables.toJSON().length, 4)

      this.clock.tick(45001)
      this.tables.removeExpiredRoutes()
      assert.equal(this.tables.toJSON().length, 2)
      assert.deepEqual(this.tables.expiries, {})
    })
  })

  describe('toJSON', function () {
    it('returns a list of routes', function * () {
      this.tables.addRoute(ledgerB, ledgerC, 'http://other-connector.example',
        new routing.Route([ [0, 0], [50, 60] ]))
      this.tables.addRoute(ledgerB, ledgerC, 'http://other-connector2.example',
        new routing.Route([ [0, 0], [100, 100] ]))

      const routes = this.tables.toJSON()
      assert.equal(routes.length, 4)
      assert.deepEqual(routes[0], {
        source_ledger: 'http://ledgerA.example',
        destination_ledger: 'http://ledgerB.example',
        connector: 'http://connector.example',
        points: [ [0, 0], [200, 100] ]
      })
      assert.deepEqual(routes[2], {
        source_ledger: 'http://ledgerB.example',
        destination_ledger: 'http://ledgerA.example',
        connector: 'http://connector.example',
        points: [ [0, 0], [100, 200] ]
      })
    })
  })
})
