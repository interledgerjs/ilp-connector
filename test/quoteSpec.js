'use strict'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const validate = require('five-bells-shared/services/validate')
const appHelper = require('./helpers/app')
const logger = require('five-bells-connector')._test.logger
const logHelper = require('./helpers/log')
const expect = require('chai').expect
const _ = require('lodash')
const ExternalError = require('../src/errors/external-error')

describe('Quotes', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)

    const testLedgers = [
      'http://cad-ledger.example:1000',
      'http://usd-ledger.example',
      'http://eur-ledger.example',
      'http://cny-ledger.example'
    ]

    _.map(testLedgers, (ledgerUri) => {
      this.ledgers.getLedger(ledgerUri).getBalance =
        function * () { return '150000' }
    })

    // Reset before and after just in case a test wants to change the precision.
    this.infoCache.reset()
    this.balanceCache.reset()
    yield this.backend.connect(ratesResponse)
    yield this.routeBroadcaster.reloadLocalRoutes()
  })

  afterEach(function () {
    nock.cleanAll()
  })

  describe('GET /quote', function () {
    it('should return a 400 if no amount is specified', function * () {
      yield this.request()
        .get('/quote?' +
          'source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('NoAmountSpecifiedError')
          expect(res.body.message).to.equal('Exactly one of source_amount ' +
            'or destination_amount must be specified')
        })
        .end()
    })

    it('should return a 400 if both source_amount and destination_amount are specified', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=100&destination_amount=100source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidUriParameterError')
          expect(res.body.message).to.equal('Exactly one of source_amount ' +
            'or destination_amount must be specified')
        })
        .end()
    })

    it('should return a 400 if source_amount is zero', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=0&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidAmountSpecifiedError')
          expect(res.body.message).to.equal('source_amount must be finite and positive')
        })
        .end()
    })

    it('should return a 400 if destination_amount is zero', function * () {
      yield this.request()
        .get('/quote?' +
          'destination_amount=0&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidAmountSpecifiedError')
          expect(res.body.message).to.equal('destination_amount must be finite and positive')
        })
        .end()
    })

    it('should return a 400 if source_amount isNan', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=foo&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidAmountSpecifiedError')
          expect(res.body.message).to.equal('source_amount must be finite and positive')
        })
        .end()
    })

    it('should return a 400 if destination_amount isNan', function * () {
      yield this.request()
        .get('/quote?' +
          'destination_amount=foo&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidAmountSpecifiedError')
          expect(res.body.message).to.equal('destination_amount must be finite and positive')
        })
        .end()
    })

    it('should return a 400 if source_amount is negative', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=-1.3&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidAmountSpecifiedError')
          expect(res.body.message).to.equal('source_amount must be finite and positive')
        })
        .end()
    })

    it('should return a 400 if destination_amount is negative', function * () {
      yield this.request()
        .get('/quote?' +
          'destination_amount=-1.4&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidAmountSpecifiedError')
          expect(res.body.message).to.equal('destination_amount must be finite and positive')
        })
        .end()
    })

    it('should return a 422 if source_ledger amount is greater than source_ledger precision', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      // Decrease precision
      this.ledgers.getLedger('http://eur-ledger.example')
        .getInfo = function * () { return {precision: 4, scale: 2} }
      this.ledgers.getLedger('http://usd-ledger.example')
        .getInfo = function * () { return {precision: 10, scale: 4} }

      yield this.request()
        .get('/quote?source_amount=12345' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableAmountError')
          expect(res.body.message).to.equal('Amount (12345.00) exceeds ledger precision on http://eur-ledger.example')
        })
        .end()
    })

    it('should return a 422 if destination_ledger amount is greater than destination_ledger precision', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      // Decrease precision
      this.ledgers.getLedger('http://eur-ledger.example')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.ledgers.getLedger('http://usd-ledger.example')
        .getInfo = function * () { return {precision: 4, scale: 4} }

      yield this.request()
        .get('/quote?destination_amount=12345' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableAmountError')
          expect(res.body.message).to.equal('Amount (12345.0000) exceeds ledger precision on http://usd-ledger.example')
        })
        .end()
    })

    it('should return 422 when the source ledger is not supported', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=100' +
          '&source_ledger=http://fake-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example' +
          '&destination_expiry_duration=1.001')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('AssetsNotTradedError')
          expect(res.body.message).to.match(/This connector does not support the given asset pair/)
        })
        .end()
    })

    it('should return a 422 if destination_ledger rounded amount is less than or equal to 0', function * () {
      yield this.request()
        .get('/quote?source_amount=0.00001' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableAmountError')
          expect(res.body.message).to.equal('Quoted destination is lower than minimum amount allowed')
        })
        .end()
    })

    it('should return 422 when the destination ledger is not supported', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=100' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://fake-ledger.example/USD' +
          '&destination_expiry_duration=1.001')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('AssetsNotTradedError')
          expect(res.body.message).to.match(/This connector does not support the given asset pair/)
        })
        .end()
    })

    it('should return a 422 if the destination_expiry_duration is too long', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=100' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example' +
          '&destination_expiry_duration=10.001')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.match(/Destination expiry duration is too long/)
        })
        .end()
    })

    it('should return a 422 if the difference between the source_expiry_duration and destination_expiry_duration is less than the minMessageWindow', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=100' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example' +
          '&destination_expiry_duration=10' +
          '&source_expiry_duration=10.999')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableExpiryError')
          expect(res.body.message).to.equal('The difference between the ' +
            'destination expiry duration and the source expiry duration is ' +
            'insufficient to ensure that we can execute the source transfers')
        })
        .end()
    })

    it('should return a 422 for insufficient liquidity', function * () {
      yield this.request()
        .get('/quote?' +
          'destination_amount=150001' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example' +
          '&destination_expiry_duration=10')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableAmountError')
          expect(res.body.message).to.equal('Insufficient liquidity in market maker account')
        })
        .end()
    })

    it('should return a 502 when unable to get precision from source_ledger', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      this.ledgers.getLedger('http://eur-ledger.example')
        .getInfo = function * () { throw new ExternalError() }
      this.ledgers.getLedger('http://usd-ledger.example')
        .getInfo = function * () { return {precision: 10, scale: 2} }

      yield this.request()
        .get('/quote?' +
          'source_amount=1500001' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example' +
          '&destination_expiry_duration=10')
        .expect(502)
        .expect(function (res) {
          expect(res.body.id).to.equal('ExternalError')
        })
        .end()
    })

    it('should return a 502 when unable to get precision from destination_ledger', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      this.ledgers.getLedger('http://eur-ledger.example')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.ledgers.getLedger('http://usd-ledger.example')
        .getInfo = function * () { throw new ExternalError() }

      yield this.request()
        .get('/quote?' +
          'source_amount=1500001' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example' +
          '&destination_expiry_duration=10')
        .expect(502)
        .expect(function (res) {
          expect(res.body.id).to.equal('ExternalError')
        })
        .end()
    })

    it('should return a 502 when unable to get balance from ledger', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      this.ledgers.getLedger('http://eur-ledger.example')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.ledgers.getLedger('http://usd-ledger.example')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.ledgers.getLedger('http://usd-ledger.example')
        .getBalance = function * () { throw new ExternalError() }

      yield this.request()
        .get('/quote?' +
          'source_amount=1500001' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example' +
          '&destination_expiry_duration=10')
        .expect(502)
        .expect(function (res) {
          expect(res.body.id).to.equal('ExternalError')
        })
        .end()
    })

    it('should return a valid Quote object', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=100' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(function (res) {
          let validation = validate('Quote', res.body)
          if (!validation.valid) {
            throw new Error('Not a valid Quote')
          }
        })
        .end()
    })

    it('should return quotes for fixed source amounts -- lower precision source_ledger', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      // Increase scale
      this.ledgers.getLedger('http://eur-ledger.example')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.ledgers.getLedger('http://usd-ledger.example')
        .getInfo = function * () { return {precision: 10, scale: 4} }

      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'http://eur-ledger.example',
          source_amount: '100.00',
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example',
          destination_amount: '105.6023', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should return quotes for fixed source amounts -- lower precision destination_ledger', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      // Increase scale
      this.ledgers.getLedger('http://eur-ledger.example')
        .getInfo = function * () { return {precision: 10, scale: 4} }
      this.ledgers.getLedger('http://usd-ledger.example')
        .getInfo = function * () { return {precision: 10, scale: 2} }

      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'http://eur-ledger.example',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example',
          destination_amount: '105.60', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('caches source and destination ledger precision', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      nock('http://eur-ledger.example')
        .get('/').reply(200, {precision: 10, scale: 4})
        .get('/').reply(500, 'Invalid request')

      nock('http://usd-ledger.example')
        .get('/').reply(200, {precision: 10, scale: 4})
        .get('/').reply(500, 'Invalid request')

      nock('http://eur-ledger.example/accounts/mark').get('')
        .reply(200, {
          name: 'mark',
          ledger: 'http://eur-ledger.example/accounts/mark',
          balance: 150000
        })
      nock('http://usd-ledger.example/accounts/mark').get('')
        .reply(200, {
          name: 'mark',
          ledger: 'http://usd-ledger.example/accounts/mark',
          balance: 150000
        })

      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(200)
        .end()

      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(200)
        .end()
    })

    it('should return quotes for fixed source amounts', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'http://eur-ledger.example',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example',
          destination_amount: '105.6023', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    // TODO: make sure we're calculating the rates correctly and in our favor
    it('should return quotes for fixed destination amounts', function * () {
      yield this.request()
        .get('/quote?' +
          'source_ledger=http://eur-ledger.example' +
          '&destination_amount=100' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'http://eur-ledger.example',
          source_amount: '94.6948', // (1/ EUR/USD Rate of 1.0592) + .2% spread + round up to overestimate + slippage
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example',
          destination_amount: '100.0000',
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should return a payment object with the source and destination amounts filled in as debits and credits', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'http://eur-ledger.example',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example',
          destination_amount: '105.6023', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should apply the spread correctly for payments where the source asset is the counter currency in the fx rates', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://usd-ledger.example' +
          '&destination_ledger=http://eur-ledger.example')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'http://usd-ledger.example',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://eur-ledger.example',
          destination_amount: '94.1277', // 1 / (EUR/USD Rate of 1.0592 + .2% spread) - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://usd-ledger.example' +
          '&destination_ledger=http://cad-ledger.example:1000')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'http://usd-ledger.example',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://cad-ledger.example:1000',
          destination_amount: '127.8537', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates and the rate must be flipped', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example:1000' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'http://cad-ledger.example:1000',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example',
          destination_amount: '77.7459', // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread) - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should fill in default values if no expiry_durations are specified', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example:1000' +
          '&destination_ledger=http://usd-ledger.example')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_expiry_duration).to.equal('6')
          expect(res.body.destination_expiry_duration).to.equal('5')
        })
        .end()
    })

    it('should return the specified expiry_durations if they are acceptable', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example:1000' +
          '&destination_ledger=http://usd-ledger.example' +
          '&source_expiry_duration=6' +
          '&destination_expiry_duration=5')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_expiry_duration).to.equal('6')
          expect(res.body.destination_expiry_duration).to.equal('5')
        })
        .end()
    })

    it('should set the source_expiry_duration if only the destination_expiry_duration is specified', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example:1000' +
          '&destination_ledger=http://usd-ledger.example' +
          '&destination_expiry_duration=5')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_expiry_duration).to.equal('6')
          expect(res.body.destination_expiry_duration).to.equal('5')
        })
        .end()
    })

    it('should set the destination_expiry_duration if only the source_expiry_duration is specified', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example:1000' +
          '&destination_ledger=http://usd-ledger.example' +
          '&source_expiry_duration=6')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_expiry_duration).to.equal('6')
          expect(res.body.destination_expiry_duration).to.equal('5')
        })
        .end()
    })

    it('should get the source_ledger if source_account is specified', function * () {
      const mockGet = nock('http://cad-ledger.example/accounts/foo')
        .get('')
        .reply(200, {ledger: 'http://cad-ledger.example:1000'})
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_account=http://cad-ledger.example/accounts/foo' +
          '&destination_ledger=http://usd-ledger.example' +
          '&source_expiry_duration=6')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_ledger).to.equal('http://cad-ledger.example:1000')
        })
        .end()
      mockGet.done()
    })

    it('should get the destination_ledger if destination_account is specified', function * () {
      const mockGet = nock('http://usd-ledger.example/accounts/foo')
        .get('')
        .reply(200, {ledger: 'http://usd-ledger.example'})
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example:1000' +
          '&destination_account=http://usd-ledger.example/accounts/foo' +
          '&source_expiry_duration=6')
        .expect(200)
        .expect(function (res) {
          expect(res.body.destination_ledger).to.equal('http://usd-ledger.example')
        })
        .end()
      mockGet.done()
    })

    it('returns 400 if no source is specified', function * () {
      nock('http://usd-ledger.example/accounts/foo')
        .get('')
        .reply(200, {ledger: 'http://usd-ledger.example'})
      yield this.request()
        .get('/quote?source_amount=100' +
          '&destination_account=http://usd-ledger.example/accounts/foo' +
          '&source_expiry_duration=6')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidUriParameterError')
          expect(res.body.message).to.equal('Missing required parameter: source_ledger or source_account')
        })
        .end()
    })

    it('returns 400 if no destination is specified', function * () {
      nock('http://cad-ledger.example/accounts/foo')
        .get('')
        .reply(200, {ledger: 'http://cad-ledger.example:1000'})
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_account=http://cad-ledger.example/accounts/foo' +
          '&source_expiry_duration=6')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidUriParameterError')
          expect(res.body.message).to.equal('Missing required parameter: destination_ledger or destination_account')
        })
        .end()
    })

    it('quotes a multi-hop route', function * () {
      nock('http://usd-ledger.example')
        .get('/accounts/alice')
        .reply(200, {ledger: 'http://usd-ledger.example'})
      nock('http://random-ledger.example')
        .get('/accounts/bob')
        .reply(200, {ledger: 'http://random-ledger.example'})
      nock('http://random-ledger.example')
        .get('/')
        .reply(200, { precision: 10, scale: 4 })

      yield this.request()
        .post('/routes')
        .send([{
          source_ledger: 'http://eur-ledger.example',
          destination_ledger: 'http://random-ledger.example',
          connector: 'http://mary.example',
          min_message_window: 1,
          source_account: 'http://eur-ledger.example/accounts/mary',
          points: [ [0, 0], [10000, 20000] ]
        }])
        .expect(200)
        .end()

      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_account=' + encodeURIComponent('http://usd-ledger.example/accounts/alice') +
          '&destination_account=' + encodeURIComponent('http://random-ledger.example/accounts/bob'))
        .expect(200)
        .expect(function (res) {
          expect(res.body).to.deep.equal({
            source_connector_account: 'mocky',
            source_ledger: 'http://usd-ledger.example',
            source_amount: '100.0000',
            source_expiry_duration: '7',
            destination_ledger: 'http://random-ledger.example',
            destination_amount: '188.2554',
            destination_expiry_duration: '5'
          })
        })
        .end()
    })

    it('fails on a same-ledger payment', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=' + encodeURIComponent('http://usd-ledger.example') +
          '&source_account=' + encodeURIComponent('http://usd-ledger.example/accounts/alice') +
          '&destination_ledger=' + encodeURIComponent('http://usd-ledger.example') +
          '&destination_account=' + encodeURIComponent('http://usd-ledger.example/accounts/bob'))
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('AssetsNotTradedError')
          expect(res.body.message).to.match(/source_ledger must be different from destination_ledger/)
        })
    })
  })
})
