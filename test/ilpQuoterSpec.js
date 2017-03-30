'use strict'

const _ = require('lodash')
const nock = require('nock')
const mock = require('mock-require')
const mockPlugin = require('./mocks/mockPlugin')
mock('ilp-plugin-mock', mockPlugin)
const expect = require('chai').expect
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const appHelper = require('./helpers/app')

const UnsupportedPairError = require('../src/errors/unsupported-pair-error')
const AssetsNotTradedError = require('../src/errors/assets-not-traded-error')
const ServerError = require('five-bells-shared/errors/server-error')
const Backend = require('../src/backends/ilp-quoter')

const precision = 10
const scale = 4

const env = _.cloneDeep(process.env)

describe('ILPQuoter', function () {
  logHelper(logger)

  beforeEach(function * () {
    process.env.UNIT_TEST_OVERRIDE = '1'
    process.env.CONNECTOR_LEDGERS = JSON.stringify({
      'localhost:3000.': {
        currency: 'USD',
        plugin: 'ilp-plugin-mock',
        options: {
          host: 'https://localhost:3000',
          account: 'https://localhost:3000/accounts/mark',
          username: 'mark',
          password: 'mark'
        }
      },
      'localhost:3001.': {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {
          host: 'https://localhost:3001',
          account: 'https://localhost:3001/accounts/mark',
          username: 'mark',
          password: 'mark'
        }
      },
      'localhost:4000.': {
        currency: 'USD',
        plugin: 'ilp-plugin-mock',
        options: {
          host: 'https://localhost:4000',
          account: 'https://localhost:4000/accounts/mark',
          username: 'mark',
          password: 'mark'
        }
      },
      'localhost:4001.': {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {
          host: 'https://localhost:4001',
          account: 'https://localhost:4001/accounts/mark',
          username: 'mark',
          password: 'mark'
        }
      }
    })

    appHelper.create(this)
    this.backendUri = 'http://marketmaker.quoter.com'
    this.pairs = [
      ['USD@localhost:3000.', 'EUR@localhost:4001.'],
      ['EUR@localhost:4001.', 'USD@localhost:3000.'],
      ['USD@localhost:4000.', 'EUR@localhost:3001.'],
      ['EUR@localhost:3001.', 'USD@localhost:4000.']
    ]
    this.unsupportedPairs = [
      ['USD@localhost:3000.', 'EUR@localhost:4001.'],
      ['XRP@localhost:4001.', 'USD@localhost:3000.'],
      ['USD@localhost:4000.', 'EUR@localhost:3001.'],
      ['EUR@localhost:3001.', 'USD@localhost:4000.']
    ]

    this.backend = new Backend({
      currencyWithLedgerPairs: this.pairs,
      backendUri: this.backendUri,
      quotePrecision: precision,
      getInfo: (ledger) => this.ledgers.getPlugin(ledger).getInfo()
    })

    const testLedgers = _.flatMap(this.pairs, (pair) => pair)

    // note that this ledger API is imaginary, just for the purpose of this test.
    // It's different from the fivebells ledger's API, for instance.
    _.each(testLedgers, (ledgerUri) => {
      nock('http://' + ledgerUri).get('/')
      .reply(200, {
        currency_code: 'doesn\'t matter, the connector will ignore this',
        currency_scale: scale
      }).persist()
    })
  })

  afterEach(function () {
    nock.cleanAll()
    process.env = _.cloneDeep(env)
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
      const scope = nock(this.backendUri)
                      .put('/pair/EUR/USD').reply(200)
                      .put('/pair/USD/EUR').reply(200)
      yield this.backend.connect()
      expect(scope.isDone()).to.be.true
    })

    it('should make sure unsupported pair is handled correctly', function * () {
      this.backend = new Backend({
        currencyWithLedgerPairs: this.unsupportedPairs,
        backendUri: this.backendUri,
        quotePrecision: precision,
        getInfo: (ledger) => this.ledgers.getPlugin(ledger).getInfo()
      })

      const scope = nock(this.backendUri)
                      .put('/pair/EUR/USD').reply(200)
                      .put('/pair/XRP/USD').reply(400)
                      .put('/pair/USD/EUR').reply(200)
      yield yieldAndAssertException(this.backend.connect(), UnsupportedPairError)
      expect(scope.isDone()).to.be.true
    })

    it('should fail for a quote with a missing source_ledger', function * () {
      const quote = { destination_ledger: 'localhost:4000.' }
      yield yieldAndAssertException(this.backend.getCurve(quote), AssetsNotTradedError)
    })

    it('should fail for a quote with a missing destination_ledger', function * () {
      const quote = { source_ledger: 'localhost:4000.' }
      yield yieldAndAssertException(this.backend.getCurve(quote), AssetsNotTradedError)
    })

    it('should make sure a valid quote returns with correct source amount', function * () {
      const quote = {
        source_ledger: 'localhost:3001.',
        destination_ledger: 'localhost:4000.'
      }
      const scope = nock(this.backendUri)
                      .get('/quote/EUR/USD/100000000/source').query({precision, scale}).reply(200, { source_amount: 123.89, destination_amount: 88.77 })
      const quoteResponse = yield this.backend.getCurve(quote)
      expect(quoteResponse.points).to.deep.equal([ [0, 0], [1238900, 887700] ])
      expect(scope.isDone()).to.be.true
    })

    it('should make sure a valid quote returns with correct destination amount', function * () {
      const quote = {
        source_ledger: 'localhost:3001.',
        destination_ledger: 'localhost:4000.'
      }
      const scope = nock(this.backendUri)
                      .get('/quote/EUR/USD/100000000/source').query({precision, scale}).reply(200, { source_amount: 99.77, destination_amount: 123.89 })
      const quoteResponse = yield this.backend.getCurve(quote)
      expect(quoteResponse.points).to.deep.equal([ [0, 0], [997700, 1238900] ])
      expect(scope.isDone()).to.be.true
    })

    it('should make sure an error is thrown if the quoter returns a 404', function * () {
      const quote = {
        source_ledger: 'localhost:3001.',
        destination_ledger: 'localhost:4000.'
      }
      const scope = nock(this.backendUri)
                      .get('/quote/EUR/USD/100000000/source').query({precision, scale}).reply(404)
      yield yieldAndAssertException(this.backend.getCurve(quote), ServerError)
      expect(scope.isDone()).to.be.true
    })

    it('should make sure an error is thrown if the quoter returns a 500', function * () {
      const quote = {
        source_ledger: 'localhost:3001.',
        destination_ledger: 'localhost:4000.'
      }
      const scope = nock(this.backendUri)
                      .get('/quote/EUR/USD/100000000/source').query({precision, scale}).reply(500)
      yield yieldAndAssertException(this.backend.getCurve(quote), ServerError)
      expect(scope.isDone()).to.be.true
    })

    it('should make sure additional information from quoter is passed in quote', function * () {
      const quote = {
        source_ledger: 'localhost:3001.',
        destination_ledger: 'localhost:4000.'
      }
      const scope = nock(this.backendUri)
                      .get('/quote/EUR/USD/100000000/source').query({precision, scale})
                                                               .reply(200, {
                                                                 source_amount: 99.77,
                                                                 destination_amount: 123.89,
                                                                 additional_info: {
                                                                   rate: 'somerate'
                                                                 }
                                                               })
      const quoteResponse = yield this.backend.getCurve(quote)
      expect(quoteResponse.points).to.deep.equal([ [0, 0], [997700, 1238900] ])
      expect(quoteResponse.additional_info).to.be.deep.equal({ rate: 'somerate' })
      expect(scope.isDone()).to.be.true
    })
  })
})
