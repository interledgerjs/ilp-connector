'use strict'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const BigNumber = require('bignumber.js')
const nock = require('nock')
const expect = require('chai').expect
const logger = require('ilp-connector')._test.logger
const logHelper = require('./helpers/log')
const appHelper = require('./helpers/app')

describe('BalanceCache', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)
  })

  afterEach(function * () { nock.cleanAll() })

  describe('get', function () {
    it('fetches the result', function * () {
      let balance = yield this.balanceCache.get('usd-ledger.')
      expect(balance).to.be.an.instanceof(BigNumber)
      expect(balance.toString()).to.equal('123.456')
    })

    it('caches the result', function * () {
      yield this.balanceCache.get('usd-ledger.')
      let balance = yield this.balanceCache.get('usd-ledger.')
      expect(balance).to.be.an.instanceof(BigNumber)
      expect(balance.toString()).to.equal('123.456')
    })
  })
})
