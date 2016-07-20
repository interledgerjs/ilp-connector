'use strict'
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const logger = require('five-bells-connector')._test.logger
const logHelper = require('./helpers/log')
const expect = require('chai').expect
const appHelper = require('./helpers/app')

describe('Pairs', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)
  })

  describe('GET /pairs', function () {
    it('returns an array of currency pairs', function * () {
      yield this.request()
        .get('/pairs')
        .expect(200)
        .expect(function (res) {
          expect(res.body.length).to.equal(8)
          expect(res.body[0]).deep.equal({
            source_asset: 'USD',
            source_ledger: 'http://usd-ledger.example',
            destination_asset: 'EUR',
            destination_ledger: 'http://eur-ledger.example'
          })
          expect(res.body[1]).deep.equal({
            source_asset: 'EUR',
            source_ledger: 'http://eur-ledger.example',
            destination_asset: 'USD',
            destination_ledger: 'http://usd-ledger.example'
          })
        })
        .end()
    })
  })
})
