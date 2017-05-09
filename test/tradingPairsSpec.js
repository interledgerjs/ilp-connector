'use strict'
const assert = require('chai').assert
const appHelper = require('./helpers/app')
const TradingPairs = require('../src/lib/trading-pairs')
const logHelper = require('./helpers/log')
const logger = require('../src/common/log')

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

describe('TradingPairs', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)
    this.pairs = new TradingPairs()
    for (let pair of this.config.get('tradingPairs')) {
      this.pairs.add(pair[0], pair[1])
    }
  })

  describe('toArray', function () {
    it('returns an array of currency pairs', function () {
      let pairs = this.pairs.toArray()

      // We need to sort the array because the return order is not guaranteed
      pairs = pairs.sort((a, b) => {
        if (a[0] > b[0]) {
          return 1
        }

        if (b[0] > a[0]) {
          return -1
        }

        if (a[1] > b[1]) {
          return 1
        }

        if (b[1] > a[1]) {
          return -1
        }

        return 0
      })

      assert.deepEqual(pairs, [
        [
          'CAD@cad-ledger.',
          'EUR@eur-ledger.'
        ],
        [
          'CAD@cad-ledger.',
          'USD@usd-ledger.'
        ],
        [
          'CNY@cny-ledger.',
          'USD@usd-ledger.'
        ],
        [
          'EUR@eur-ledger.',
          'CAD@cad-ledger.'
        ],
        [
          'EUR@eur-ledger.',
          'USD@usd-ledger.'
        ],
        [
          'USD@usd-ledger.',
          'CAD@cad-ledger.'
        ],
        [
          'USD@usd-ledger.',
          'CNY@cny-ledger.'
        ],
        [
          'USD@usd-ledger.',
          'EUR@eur-ledger.'
        ]
      ])
    })
  })

  describe('addPairs', function () {
    it('adds a pair to the array', function () {
      assert.deepEqual(this.pairs.toArray().slice(-1)[0], ['CNY@cny-ledger.', 'USD@usd-ledger.'])
      assert.equal(this.pairs.toArray().length, 8)
      this.pairs.addPairs([['XRP@xrp-ledger.', 'USD@usd-ledger.']])
      assert.deepEqual(this.pairs.toArray().slice(-1)[0], ['XRP@xrp-ledger.', 'USD@usd-ledger.'])
      assert.equal(this.pairs.toArray().length, 9)
    })
  })

  describe('removeAll', function () {
    it('removes all pairs containing a ledger', function () {
      assert.equal(this.pairs.toArray().length, 8)
      this.pairs.removeAll('USD@usd-ledger.')
      assert.equal(this.pairs.toArray().length, 2)
    })
  })
})
