'use strict'
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const logger = require('five-bells-connector')._test.logger
const logHelper = require('five-bells-shared/testHelpers/log')
const expect = require('chai').expect

describe('Pairs', function () {
  logHelper(logger)

  describe('GET /pairs', function () {
    it('returns an array of currency pairs', function * () {
      yield this.request()
        .get('/pairs')
        .expect(200)
        .expect(function (res) {
          expect(res.body.length).to.equal(8)
          expect(res.body[0]).deep.equal({
            source_asset: 'USD',
            source_ledger: 'http://usd-ledger.example/USD',
            destination_asset: 'EUR',
            destination_ledger: 'http://eur-ledger.example/EUR'
          })
          expect(res.body[1]).deep.equal({
            source_asset: 'EUR',
            source_ledger: 'http://eur-ledger.example/EUR',
            destination_asset: 'USD',
            destination_ledger: 'http://usd-ledger.example/USD'
          })
        })
        .end()
    })
  })
})
