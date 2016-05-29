'use strict'

const assert = require('assert')
const RoutingTables = require('five-bells-connector')._test.RoutingTables
const sinon = require('sinon')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT
const ledgerA = 'http://ledgerA.example'
const ledgerB = 'http://ledgerB.example'
const ledgerC = 'http://ledgerC.example'

// connector users
const markA = 'http://ledgerA.example/accounts/mark'
const markB = 'http://ledgerB.example/accounts/mark'

describe('RoutingTables', function () {
  beforeEach(function * () {
    this.clock = sinon.useFakeTimers(START_DATE)
    this.tables = new RoutingTables('http://mark.example', [{
      source_ledger: ledgerA,
      destination_ledger: ledgerB,
      connector: 'http://mark.example',
      min_message_window: 1,
      source_account: markA,
      destination_account: markB,
      points: [ [0, 0], [200, 100] ]
    }, {
      source_ledger: ledgerB,
      destination_ledger: ledgerA,
      connector: 'http://mark.example',
      min_message_window: 1,
      source_account: markB,
      destination_account: markA,
      points: [ [0, 0], [100, 200] ]
    }])
  })

  afterEach(function * () {
    this.clock.restore()
  })

  describe('addRoute', function () {
    it('doesn\'t create a route from A→B→A', function * () {
      assert.strictEqual(
        this.tables.sources[ledgerA].destinations.get(ledgerA),
        undefined)
    })

    it('doesn\'t create a route from A→C→B if A→C isnt local', function * () {
      // Implicitly create A→C
      this.tables.addRoute({
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        connector: 'http://mary.example',
        min_message_window: 1,
        points: [ [0, 0], [50, 60] ]
      })
      // This should *not* create A→C→B, because A→C isn't local.
      this.tables.addRoute({
        source_ledger: ledgerC,
        destination_ledger: ledgerB,
        connector: 'http://mary.example',
        min_message_window: 1,
        points: [ [0, 0], [200, 100] ]
      })
      assert.strictEqual(
        this.tables.sources[ledgerA].destinations.get(ledgerB).get('http://mary.example'),
        undefined)
    })

    it('doesn\'t override local pair paths with a remote one', function * () {
      this.tables.addRoute({
        source_ledger: ledgerA,
        destination_ledger: ledgerB,
        connector: 'http://mary.example',
        min_message_window: 1,
        points: [ [0, 0], [200, 9999] ]
      })
      // Dont create a second A→B
      assert.strictEqual(
        this.tables.sources[ledgerA].destinations.get(ledgerB).get('http://mary.example'),
        undefined)
    })

    it('doesn\'t override simple local path A→B with A→C→B', function * () {
      this.tables.addLocalRoutes([
        {
          source_ledger: ledgerA,
          destination_ledger: ledgerC,
          connector: 'http://mark.example',
          min_message_window: 1,
          points: [ [0, 0], [100, 999] ]
        }, {
          source_ledger: ledgerC,
          destination_ledger: ledgerB,
          connector: 'http://mark.example',
          min_message_window: 1,
          points: [ [0, 0], [100, 999] ]
        }
      ])
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerA, ledgerB, 100),
        { bestHop: 'http://mark.example', bestValue: 50 })
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerA, ledgerB, 200),
        { bestHop: 'http://mark.example', bestValue: 100 })
    })
  })

  describe('_findBestHopForSourceAmount', function () {
    it('finds the best next hop when there is one route', function * () {
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerA, ledgerB, 0),
        { bestHop: 'http://mark.example', bestValue: 0 })
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerA, ledgerB, 100),
        { bestHop: 'http://mark.example', bestValue: 50 })
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerA, ledgerB, 200),
        { bestHop: 'http://mark.example', bestValue: 100 })
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerA, ledgerB, 300),
        { bestHop: 'http://mark.example', bestValue: 100 })
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerB, ledgerA, 100),
        { bestHop: 'http://mark.example', bestValue: 200 })
    })

    it('finds the best next hop when there are multiple hops', function * () {
      this.tables.addRoute({
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        connector: 'http://mary.example',
        min_message_window: 1,
        points: [ [0, 0], [200, 100] ]
      })
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerA, ledgerC, 100),
        { bestHop: 'http://mary.example', bestValue: 25 })
    })

    it('finds the best next hop when there are multiple routes', function * () {
      this.tables.addRoute({
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        connector: 'http://mary.example',
        min_message_window: 1,
        points: [ [0, 0], [50, 60] ]
      })
      this.tables.addRoute({
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        connector: 'http://martin.example',
        min_message_window: 1,
        points: [ [0, 0], [100, 100] ]
      })
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerA, ledgerC, 100),
        { bestHop: 'http://mary.example', bestValue: 60 })
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerA, ledgerC, 150),
        { bestHop: 'http://martin.example', bestValue: 75 })
      assertSubset(
        this.tables._findBestHopForSourceAmount(ledgerA, ledgerC, 200),
        { bestHop: 'http://martin.example', bestValue: 100 })
    })
  })

  describe('_findBestHopForDestinationAmount', function () {
    it('finds the best next hop when there is one route', function * () {
      assertSubset(
        this.tables._findBestHopForDestinationAmount(ledgerA, ledgerB, 0),
        { bestHop: 'http://mark.example', bestCost: 0 })
      assertSubset(
        this.tables._findBestHopForDestinationAmount(ledgerA, ledgerB, 50),
        { bestHop: 'http://mark.example', bestCost: 100 })
      assertSubset(
        this.tables._findBestHopForDestinationAmount(ledgerA, ledgerB, 100),
        { bestHop: 'http://mark.example', bestCost: 200 })
      assert.equal(
        this.tables._findBestHopForDestinationAmount(ledgerA, ledgerB, 150),
        undefined)
      assertSubset(
        this.tables._findBestHopForDestinationAmount(ledgerB, ledgerA, 200),
        { bestHop: 'http://mark.example', bestCost: 100 })
    })
  })

  describe('removeExpiredRoutes', function () {
    it('expires old routes', function * () {
      this.tables.addRoute({
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        connector: 'http://mary.example',
        min_message_window: 1,
        points: [ [0, 0], [50, 60] ]
      })

      // expire nothing
      assert.equal(this.tables.toJSON().length, 3)
      this.tables.removeExpiredRoutes()
      assert.equal(this.tables.toJSON().length, 3)

      this.clock.tick(45001)
      this.tables.removeExpiredRoutes()
      assert.equal(this.tables.toJSON().length, 2)
    })
  })

  describe('toJSON', function () {
    it('returns a list of routes', function * () {
      this.tables.addRoute({
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        connector: 'http://mary.example',
        min_message_window: 1,
        points: [ [0, 0], [50, 60] ]
      })
      this.tables.addRoute({
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        connector: 'http://martin.example',
        min_message_window: 2, // this min_message_window is higher, so it is used
        points: [ [0, 0], [100, 100] ]
      })

      assert.deepStrictEqual(this.tables.toJSON(), [{
        source_ledger: ledgerA,
        destination_ledger: ledgerB,
        connector: 'http://mark.example',
        min_message_window: 1,
        source_account: markA,
        points: [ [0, 0], [200, 100] ]
      }, {
        source_ledger: ledgerA,
        destination_ledger: ledgerC,
        connector: 'http://mark.example',
        min_message_window: 3,
        source_account: markA,
        points: [
          [0, 0], /* .. mary .. */
          [100, 60], /* .. mary (max) .. */
          [120, 60], /* .. mark .. */
          [200, 100] /* .. mark (max) */
        ]
      }, {
        source_ledger: ledgerB,
        destination_ledger: ledgerA,
        connector: 'http://mark.example',
        min_message_window: 1,
        source_account: markB,
        points: [ [0, 0], [100, 200] ]
      }])
    })

    ;[
      {
        desc: 'finds an intersection between a segment a tail',
        mary: [ [0, 0], [100, 1000] ],
        martin: [ [0, 0], [10, 500] ],
        output: [
          [0, 0], /* .. martin .. */
          [20, 500], /* .. martin (max) .. */
          [100, 500], /* .. mary .. */
          [200, 1000] /* .. mary (max) .. */
        ]
      },
      {
        desc: 'finds an intersection between two segments with slope > 0',
        mary: [ [0, 0], [100, 1000] ],
        martin: [ [0, 0], [100 / 3, 450], [200 / 3, 550] ],
        output: [
          [0, 0], /* .. martin (segment 1) .. */
          [200 / 3, 450], /* .. martin (segment 2) .. */
          [100, 500], /* .. mary .. */
          [400 / 3, 666.6666666666667], /* .. mary (redundant point) .. */
          [200, 1000] /* .. mary .. (max) */
        ]
      }
    ].forEach(function (test) {
      it(test.desc, function * () {
        this.tables.addRoute({
          source_ledger: ledgerB,
          destination_ledger: ledgerC,
          connector: 'http://mary.example',
          min_message_window: 1,
          points: test.mary
        })
        this.tables.addRoute({
          source_ledger: ledgerB,
          destination_ledger: ledgerC,
          connector: 'http://martin.example',
          min_message_window: 1,
          points: test.martin
        })

        assert.deepStrictEqual(this.tables.toJSON()[1], {
          source_ledger: ledgerA,
          destination_ledger: ledgerC,
          connector: 'http://mark.example',
          min_message_window: 2,
          source_account: markA,
          points: test.output
        })
      })
    }, this)
  })

  describe('findBestHopForDestinationAmount', function () {
    it('finds the best route when there is one path', function * () {
      this.tables.addRoute({
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        connector: 'http://mary.example',
        min_message_window: 1,
        source_account: ledgerB + '/accounts/mary',
        points: [ [0, 0], [200, 100] ]
      })
      assert.deepEqual(
        this.tables.findBestHopForDestinationAmount(ledgerA, ledgerC, '25'),
        {
          connector: 'http://mary.example',
          sourceLedger: ledgerA,
          sourceAmount: (100).toString(),
          destinationLedger: ledgerB,
          destinationAmount: (50).toString(),
          destinationDebitAccount: ledgerB + '/accounts/mark',
          destinationCreditAccount: ledgerB + '/accounts/mary',
          finalLedger: ledgerC,
          finalAmount: '25',
          minMessageWindow: 2
        })
    })

    it('finds the best route when there is one hop', function * () {
      assert.deepStrictEqual(
        this.tables.findBestHopForDestinationAmount(ledgerA, ledgerB, '50'),
        {
          connector: 'http://mark.example',
          sourceLedger: ledgerA,
          sourceAmount: (100).toString(),
          destinationLedger: ledgerB,
          destinationAmount: (50).toString(),
          destinationDebitAccount: markB,
          destinationCreditAccount: null,
          finalLedger: ledgerB,
          finalAmount: '50',
          minMessageWindow: 1
        })
    })
  })

  describe('findBestHopForSourceAmount', function () {
    it('finds the best route when there is one hop', function * () {
      assert.deepStrictEqual(
        this.tables.findBestHopForSourceAmount(ledgerA, ledgerB, '100'),
        {
          connector: 'http://mark.example',
          sourceLedger: ledgerA,
          sourceAmount: '100',
          destinationLedger: ledgerB,
          destinationAmount: (50).toString(),
          destinationDebitAccount: markB,
          destinationCreditAccount: null,
          finalLedger: ledgerB,
          finalAmount: (50).toString(),
          minMessageWindow: 1
        })
    })
  })
})

// Like assert.deepStrictEqual, but allow missing top-level keys in `actual`.
function assertSubset (actual, expect) {
  for (const key in expect) {
    assert.deepStrictEqual(actual[key], expect[key])
  }
}
