'use strict'
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const logger = require('ilp-connector')._test.logger
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
            source_ledger: 'usd-ledger.',
            destination_asset: 'EUR',
            destination_ledger: 'eur-ledger.'
          })
          expect(res.body[1]).deep.equal({
            source_asset: 'EUR',
            source_ledger: 'eur-ledger.',
            destination_asset: 'USD',
            destination_ledger: 'usd-ledger.'
          })
        })
        .end()
    })
  })
})
