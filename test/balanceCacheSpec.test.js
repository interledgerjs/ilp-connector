'use strict'

const BigNumber = require('bignumber.js')
const nock = require('nock')
const expect = require('chai').expect
const BalanceCache = require('../lib/balance-cache')

describe('BalanceCache', function () {
  beforeEach(function *() {
    this.cache = new BalanceCache({
      ledgerCredentials: {
        'http://ledger-ok.local': {
          account_uri: 'http://ledger-ok.local',
          username: 'bob',
          password: 'bob'
        }
      }
    })

    nock('http://ledger-ok.local').get('/')
      .reply(200, { balance: '123.456' })
  })

  afterEach(function *() { nock.cleanAll() })

  describe('get', function () {
    it('fetches the result', function *() {
      let balance = yield this.cache.get('http://ledger-ok.local')
      expect(balance).to.be.an.instanceof(BigNumber)
      expect(balance.toString()).to.equal('123.456')
    })

    it('caches the result', function *() {
      yield this.cache.get('http://ledger-ok.local')
      let balance = yield this.cache.get('http://ledger-ok.local')
      expect(balance).to.be.an.instanceof(BigNumber)
      expect(balance.toString()).to.equal('123.456')
    })
  })
})
