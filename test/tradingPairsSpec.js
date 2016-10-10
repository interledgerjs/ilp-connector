'use strict'
const assert = require('chai').assert
const appHelper = require('./helpers/app')
const config = require('../src/lib/config')()
const TradingPairs = require('../src/lib/trading-pairs')

describe('TradingPairs', function () {
  beforeEach(function * () {
    appHelper.create(this)
    this.pairs = new TradingPairs(config.get('tradingPairs'))
  })

  describe('toArray', function () {
    it('returns an array of currency pairs', function () {
      assert.deepEqual(this.pairs.toArray()[0], ['USD@usd-ledger.', 'EUR@eur-ledger.'])
      assert.deepEqual(this.pairs.toArray()[1], ['EUR@eur-ledger.', 'USD@usd-ledger.'])
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

  describe('addAll', function () {
    it('adds all pairs with a new ledger to the array', function () {
      assert.equal(this.pairs.toArray().length, 8)
      this.pairs.addAll('BTC@btc-ledger.')
      assert.equal(this.pairs.toArray().length, 16)
    })
  })

  describe('removeAll', function () {
    it('removes all pairs containing a ledger', function () {
      assert.equal(this.pairs.toArray().length, 8)
      this.pairs.removeAll('usd-ledger.')
      assert.equal(this.pairs.toArray().length, 2)
    })
  })
})
