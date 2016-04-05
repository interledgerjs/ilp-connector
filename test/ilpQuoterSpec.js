'use strict'

const nock = require('nock')
const expect = require('chai').expect

const UnsupportedPairError = require('../src/errors/unsupported-pair-error')
const NoAmountSpecifiedError = require('../src/errors/no-amount-specified-error')
const AssetsNotTradedError = require('../src/errors/assets-not-traded-error')
const ServerError = require('five-bells-shared/errors/server-error')
const Backend = require('../src/backends/ilp-quoter')

describe('ILPQuoter', function () {
  beforeEach(function * () {
    this.backendUri = 'http://marketmaker.quoter.com'
    this.pairs =
      [['USD@https://localhost:3000', 'EUR@https://localhost:4001'],
       ['EUR@https://localhost:4001', 'USD@https://localhost:3000'],
       ['USD@https://localhost:4000', 'EUR@https://localhost:3001'],
       ['EUR@https://localhost:3001', 'USD@https://localhost:4000']]
    this.unsupportedPairs =
      [['USD@https://localhost:3000', 'EUR@https://localhost:4001'],
       ['XRP@https://localhost:4001', 'USD@https://localhost:3000'],
       ['USD@https://localhost:4000', 'EUR@https://localhost:3001'],
       ['EUR@https://localhost:3001', 'USD@https://localhost:4000']]
  })

  afterEach(function () {
    nock.cleanAll()
  })

  function * yieldAndAssertException (action, exception) {
    let err
    try {
      yield action
    } catch (e) {
      err = e
    }
    expect(err).to.be.an.instanceOf(exception)
  }

  describe('quoter flow', function () {
    it('should make sure the backend PUT /pair is called', function * () {
      this.backend = new Backend({ currencyWithLedgerPairs: this.pairs, backendUri: this.backendUri })
      const scope = nock(this.backendUri)
                      .put('/pair/EUR/USD').reply(200)
                      .put('/pair/USD/EUR').reply(200)
      yield this.backend.connect()
      scope.isDone()
    })

    it('should make sure unsupported pair is handled correctly', function * () {
      this.backend = new Backend({ currencyWithLedgerPairs: this.unsupportedPairs, backendUri: this.backendUri })
      const scope = nock(this.backendUri)
                      .put('/pair/EUR/USD').reply(200)
                      .put('/pair/XRP/USD').reply(400)
                      .put('/pair/USD/EUR').reply(200)
      yield yieldAndAssertException(this.backend.connect(), UnsupportedPairError)
      scope.isDone()
    })

    it('should fail for a quote with a missing source_ledger', function * () {
      this.backend = new Backend({ currencyWithLedgerPairs: this.pairs, backendUri: this.backendUri })
      const quote = { source_amount: '123', destination_ledger: 'https://localhost:4000' }
      yield yieldAndAssertException(this.backend.getQuote(quote), AssetsNotTradedError)
    })

    it('should fail for a quote with a missing destination_ledger', function * () {
      this.backend = new Backend({ currencyWithLedgerPairs: this.pairs, backendUri: this.backendUri })
      const quote = { source_amount: '123', source_ledger: 'https://localhost:4000' }
      yield yieldAndAssertException(this.backend.getQuote(quote), AssetsNotTradedError)
    })

    it('should fail for a quote with a missing amount', function * () {
      this.backend = new Backend({ currencyWithLedgerPairs: this.pairs, backendUri: this.backendUri })
      const quote = { source_ledger: 'https://localhost:3001', destination_ledger: 'https://localhost:4000' }
      yield yieldAndAssertException(this.backend.getQuote(quote), NoAmountSpecifiedError)
    })

    it('should make sure a valid quote returns with correct source amount', function * () {
      this.backend = new Backend({ currencyWithLedgerPairs: this.pairs, backendUri: this.backendUri })
      const quote = { source_amount: 123.89,
                      source_ledger: 'https://localhost:3001',
                      destination_ledger: 'https://localhost:4000' }
      const scope = nock(this.backendUri)
                      .get('/quote/EUR/USD/123.89/source').reply(200, { source_amount: 123.89, destination_amount: 88.77 })
      const quoteResponse = yield this.backend.getQuote(quote)
      expect(quoteResponse.source_amount).to.be.equal(123.89)
      expect(quoteResponse.destination_amount).to.be.equal(88.77)
      scope.isDone()
    })

    it('should make sure a valid quote returns with correct destination amount', function * () {
      this.backend = new Backend({ currencyWithLedgerPairs: this.pairs, backendUri: this.backendUri })
      const quote = { destination_amount: 123.89,
                      source_ledger: 'https://localhost:3001',
                      destination_ledger: 'https://localhost:4000' }
      const scope = nock(this.backendUri)
                      .get('/quote/EUR/USD/123.89/destination').reply(200, { source_amount: 99.77, destination_amount: 123.89 })
      const quoteResponse = yield this.backend.getQuote(quote)
      expect(quoteResponse.source_amount).to.be.equal(99.77)
      expect(quoteResponse.destination_amount).to.be.equal(123.89)
      scope.isDone()
    })

    it('should make sure an error is thrown if the quoter returns a 404', function * () {
      this.backend = new Backend({ currencyWithLedgerPairs: this.pairs, backendUri: this.backendUri })
      const quote = { source_amount: 123.89,
                      source_ledger: 'https://localhost:3001',
                      destination_ledger: 'https://localhost:4000' }
      const scope = nock(this.backendUri)
                      .get('/quote/EUR/USD/123.89/source').reply(404)
      yield yieldAndAssertException(this.backend.getQuote(quote), ServerError)
      scope.isDone()
    })

    it('should make sure an error is thrown if the quoter returns a 500', function * () {
      this.backend = new Backend({ currencyWithLedgerPairs: this.pairs, backendUri: this.backendUri })
      const quote = { source_amount: 123.89,
                      source_ledger: 'https://localhost:3001',
                      destination_ledger: 'https://localhost:4000' }
      const scope = nock(this.backendUri)
                      .get('/quote/EUR/USD/123.89/source').reply(500)
      yield yieldAndAssertException(this.backend.getQuote(quote), ServerError)
      scope.isDone()
    })
  })
})

