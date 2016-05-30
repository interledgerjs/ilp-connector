'use strict'

const BigNumber = require('bignumber.js')
const nock = require('nock')
const expect = require('chai').expect
const logger = require('five-bells-connector')._test.logger
const logHelper = require('five-bells-shared/testHelpers/log')
const BalanceCache = require('five-bells-connector')._test.BalanceCache

describe('BalanceCache', function () {
  logHelper(logger)

  beforeEach(function * () {
    this.cache = new BalanceCache(this.ledgers)

    nock('http://usd-ledger.example').get('/accounts/mark')
      .reply(200, { balance: '123.456' })
  })

  afterEach(function * () { nock.cleanAll() })

  describe('get', function () {
    it('fetches the result', function * () {
      let balance = yield this.cache.get('http://usd-ledger.example')
      expect(balance).to.be.an.instanceof(BigNumber)
      expect(balance.toString()).to.equal('123.456')
    })

    it('caches the result', function * () {
      yield this.cache.get('http://usd-ledger.example')
      let balance = yield this.cache.get('http://usd-ledger.example')
      expect(balance).to.be.an.instanceof(BigNumber)
      expect(balance.toString()).to.equal('123.456')
    })
  })
})
