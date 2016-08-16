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

    const testLedgers = ['cad-ledger.', 'usd-ledger.', 'eur-ledger.', 'cny-ledger.']
    _.map(testLedgers, (ledgerUri) => {
      this.core.getPlugin(ledgerUri).getBalance =
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
          'source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
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
          'source_amount=100&destination_amount=100source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
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
          'source_amount=0&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
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
          'destination_amount=0&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
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
          'source_amount=foo&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
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
          'destination_amount=foo&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
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
          'source_amount=-1.3&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
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
          'destination_amount=-1.4&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidAmountSpecifiedError')
          expect(res.body.message).to.equal('destination_amount must be finite and positive')
        })
        .end()
    })

    it('should return a 422 if source_address amount is greater than source_address precision', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      // Decrease precision
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { return {precision: 4, scale: 2} }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 4} }

      yield this.request()
        .get('/quote?source_amount=12345' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableAmountError')
          expect(res.body.message).to.equal('Amount (12345.00) exceeds ledger precision on eur-ledger.')
        })
        .end()
    })

    it('should return a 422 if destination_address amount is greater than destination_address precision', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      // Decrease precision
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { return {precision: 4, scale: 4} }

      yield this.request()
        .get('/quote?destination_amount=12345' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableAmountError')
          expect(res.body.message).to.equal('Amount (12345.0000) exceeds ledger precision on usd-ledger.')
        })
        .end()
    })

    it('should return 422 when the source ledger is not supported', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=100' +
          '&source_address=http://fake-ledger.example/EUR' +
          '&destination_address=usd-ledger.bob' +
          '&destination_expiry_duration=1.001')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('AssetsNotTradedError')
          expect(res.body.message).to.match(/This connector does not support the given asset pair/)
        })
        .end()
    })

    it('should return a 422 if destination_address rounded amount is less than or equal to 0', function * () {
      yield this.request()
        .get('/quote?source_amount=0.00001' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
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
          '&source_address=eur-ledger.alice' +
          '&destination_address=http://fake-ledger.example/USD' +
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
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob' +
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
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob' +
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
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob' +
          '&destination_expiry_duration=10')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableAmountError')
          expect(res.body.message).to.equal('Insufficient liquidity in market maker account')
        })
        .end()
    })

    it('should return a 502 when unable to get precision from source_address', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { throw new ExternalError() }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }

      yield this.request()
        .get('/quote?' +
          'source_amount=1500001' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob' +
          '&destination_expiry_duration=10')
        .expect(502)
        .expect(function (res) {
          expect(res.body.id).to.equal('ExternalError')
        })
        .end()
    })

    it('should return a 502 when unable to get precision from destination_address', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { throw new ExternalError() }

      yield this.request()
        .get('/quote?' +
          'source_amount=1500001' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob' +
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
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.core.getPlugin('usd-ledger.')
        .getBalance = function * () { throw new ExternalError() }

      yield this.request()
        .get('/quote?' +
          'source_amount=1500001' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob' +
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
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(function (res) {
          let validation = validate('Quote', res.body)
          if (!validation.valid) {
            throw new Error('Not a valid Quote')
          }
        })
        .end()
    })

    it('should return quotes for fixed source amounts -- lower precision source_address', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      // Increase scale
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 4} }

      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'eur-ledger.',
          source_amount: '100.00',
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '105.6024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should return quotes for fixed source amounts -- lower precision destination_address', function * () {
      this.infoCache.reset()
      nock.cleanAll()
      // Increase scale
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 4} }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }

      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'eur-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
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
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(200)
        .end()

      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(200)
        .end()
    })

    it('should return quotes for fixed source amounts', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'eur-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '105.6024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    // TODO: make sure we're calculating the rates correctly and in our favor
    it('should return quotes for fixed destination amounts', function * () {
      yield this.request()
        .get('/quote?' +
          'source_address=eur-ledger.alice' +
          '&destination_amount=100' +
          '&destination_address=usd-ledger.bob')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'eur-ledger.',
          source_amount: '94.6947', // (1/ EUR/USD Rate of 1.0592) + .2% spread + round up to overestimate + slippage
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '100.0000',
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should return a payment object with the source and destination amounts filled in as debits and credits', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=eur-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'eur-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '105.6024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should apply the spread correctly for payments where the source asset is the counter currency in the fx rates', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=usd-ledger.bob' +
          '&destination_address=eur-ledger.alice')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'usd-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'eur-ledger.',
          destination_amount: '94.1278', // 1 / (EUR/USD Rate of 1.0592 + .2% spread) - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=usd-ledger.bob' +
          '&destination_address=cad-ledger.carl')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'usd-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'cad-ledger.',
          destination_amount: '127.8538', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates and the rate must be flipped', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=cad-ledger.carl' +
          '&destination_address=usd-ledger.bob')
        .expect(200, {
          source_connector_account: 'mocky',
          source_ledger: 'cad-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '77.7460', // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread) - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should fill in default values if no expiry_durations are specified', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=cad-ledger.carl' +
          '&destination_address=usd-ledger.bob')
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
          '&source_address=cad-ledger.carl' +
          '&destination_address=usd-ledger.bob' +
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
          '&source_address=cad-ledger.carl' +
          '&destination_address=usd-ledger.bob' +
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
          '&source_address=cad-ledger.carl' +
          '&destination_address=usd-ledger.bob' +
          '&source_expiry_duration=6')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_expiry_duration).to.equal('6')
          expect(res.body.destination_expiry_duration).to.equal('5')
        })
        .end()
    })

    it('returns 400 if no source is specified', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&destination_address=usd-ledger.foo' +
          '&source_expiry_duration=6')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidUriParameterError')
          expect(res.body.message).to.equal('Missing required parameter: source_address')
        })
        .end()
    })

    it('returns 400 if no destination is specified', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=cad-ledger.foo' +
          '&source_expiry_duration=6')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidUriParameterError')
          expect(res.body.message).to.equal('Missing required parameter: destination_address')
        })
        .end()
    })

    it('quotes a multi-hop route', function * () {
      yield this.request()
        .post('/routes')
        .send([{
          source_ledger: 'eur-ledger.',
          destination_ledger: 'random-ledger.',
          connector: 'http://mary.example',
          min_message_window: 1,
          source_account: 'eur-ledger.mary',
          points: [ [0, 0], [10000, 20000] ]
        }])
        .expect(200)
        .end()

      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=usd-ledger.alice' +
          '&destination_address=random-ledger.bob' +
          '&destination_precision=10' +
          '&destination_scale=4')
        .expect(200)
        .expect(function (res) {
          expect(res.body).to.deep.equal({
            source_connector_account: 'mocky',
            source_ledger: 'usd-ledger.',
            source_amount: '100.0000',
            source_expiry_duration: '7',
            destination_ledger: 'random-ledger.',
            destination_amount: '188.2556',
            destination_expiry_duration: '5'
          })
        })
        .end()
    })

    it('fails on a same-ledger quote', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_address=usd-ledger.alice' +
          '&destination_address=usd-ledger.bob')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('AssetsNotTradedError')
          expect(res.body.message).to.match(/This connector does not support the given asset pair/)
        })
    })
  })
})
