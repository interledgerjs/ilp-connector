'use strict'
const parseURL = require('url').parse
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const validate = require('five-bells-shared/services/validate')
const appHelper = require('./helpers/app')
const logger = require('five-bells-connector')._test.logger
const balanceCache = require('five-bells-connector')._test.balanceCache
const logHelper = require('five-bells-shared/testHelpers/log')
const expect = require('chai').expect
const _ = require('lodash')
const precisionCache = require('five-bells-connector')._test.precisionCache
const parseUrl = require('url').parse

describe('Quotes', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)

    const testLedgers = [
      'http://cad-ledger.example:1000/CAD',
      'http://usd-ledger.example/USD',
      'http://eur-ledger.example/EUR',
      'http://cny-ledger.example/CNY'
    ]

    _.each(testLedgers, (ledgerUri) => {
      nock(ledgerUri).get('')
      .reply(200, {
        precision: 10,
        scale: 4
      })
    })

    // Connector queries its balances when getting a quote to ensure it has sufficient funds.
    _.map(testLedgers, (ledgerUri) => 'http://' + parseUrl(ledgerUri).host + '/accounts/mark')
    .forEach((connectorAccountUri) => {
      nock(connectorAccountUri).get('')
        .reply(200, {
          name: 'mark',
          ledger: 'http://' + parseURL(connectorAccountUri).host,
          balance: 150000
        })
    })
    balanceCache.reset()
    precisionCache.reset()

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
          'source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
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
          'source_amount=100&destination_amount=100source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
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
          'source_amount=0&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
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
          'destination_amount=0&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
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
          'destination_amount=foo&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidAmountSpecifiedError')
          expect(res.body.message).to.equal('destination_amount must be finite and positive')
        })
        .end()
    })

    it('should return a 400 if destination_amount isNan', function * () {
      yield this.request()
        .get('/quote?' +
          'destination_amount=foo&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(400)
        .expect(function (res) {
          expect(res.body.id).to.equal('InvalidAmountSpecifiedError')
          expect(res.body.message).to.equal('destination_amount must be finite and positive')
        })
        .end()
    })

    it('should return a 422 if source_ledger amount is greater than source_ledger precision', function * () {
      nock.cleanAll()
      // Decrease precision
      nock('http://eur-ledger.example/EUR').get('').reply(200, {precision: 4, scale: 2})
      nock('http://usd-ledger.example/USD').get('').reply(200, {precision: 10, scale: 4})
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
        .get('/quote?source_amount=12345' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableAmountError')
          expect(res.body.message).to.equal('Amount (12345.00) exceeds ledger precision on source ledger')
        })
        .end()
    })

    it('should return a 422 if destination_ledger amount is greater than destination_ledger precision', function * () {
      nock.cleanAll()
      // Decrease precision
      nock('http://eur-ledger.example/EUR').get('').reply(200, {precision: 10, scale: 2})
      nock('http://usd-ledger.example/USD').get('').reply(200, {precision: 4, scale: 4})
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
        .get('/quote?source_amount=12345' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableAmountError')
          expect(res.body.message).to.equal('Amount (13049.6723) exceeds ledger precision on destination ledger')
        })
        .end()
    })

    it('should return 422 when the source ledger is not supported', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=100' +
          '&source_ledger=http://fake-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD' +
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
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
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
          '&source_ledger=http://eur-ledger.example/EUR' +
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
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD' +
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
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD' +
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
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD' +
          '&destination_expiry_duration=10')
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('UnacceptableAmountError')
          expect(res.body.message).to.equal('Insufficient liquidity in market maker account')
        })
        .end()
    })

    it('should return a 502 when unable to get precision from source_ledger', function * () {
      nock.cleanAll()
      nock('http://eur-ledger.example/EUR').get('').reply(500)
      nock('http://usd-ledger.example/USD').get('').reply(200, {precision: 10, scale: 2})

      yield this.request()
        .get('/quote?' +
          'source_amount=1500001' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD' +
          '&destination_expiry_duration=10')
        .expect(502)
        .expect(function (res) {
          expect(res.body.id).to.equal('ExternalError')
          expect(res.body.message).to.equal('Unable to determine ledger precision')
        })
        .end()
    })

    it('should return a 502 when unable to get precision from destination_ledger', function * () {
      nock.cleanAll()
      nock('http://eur-ledger.example/EUR').get('').reply(200, {precision: 10, scale: 2})
      nock('http://usd-ledger.example/USD').get('').reply(500)

      yield this.request()
        .get('/quote?' +
          'source_amount=1500001' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD' +
          '&destination_expiry_duration=10')
        .expect(502)
        .expect(function (res) {
          expect(res.body.id).to.equal('ExternalError')
          expect(res.body.message).to.equal('Unable to determine ledger precision')
        })
        .end()
    })

    it('should return a 502 when unable to get balance from ledger', function * () {
      nock.cleanAll()
      nock('http://eur-ledger.example/EUR').get('').reply(200, {precision: 10, scale: 2})
      nock('http://usd-ledger.example/USD').get('').reply(200, {precision: 10, scale: 2})
      nock('http://eur-ledger.example/accounts/').get('').reply(500)

      yield this.request()
        .get('/quote?' +
          'source_amount=1500001' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD' +
          '&destination_expiry_duration=10')
        .expect(502)
        .expect(function (res) {
          expect(res.body.id).to.equal('ExternalError')
          expect(res.body.message).to.equal('Unable to determine current balance')
        })
        .end()
    })

    it('should return a valid Quote object', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=100' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(function (res) {
          let validation = validate('Quote', res.body)
          if (!validation.valid) {
            throw new Error('Not a valid Quote')
          }
        })
        .end()
    })

    it('should return quotes for fixed source amounts -- lower precision source_ledger', function * () {
      nock.cleanAll()
      // Increase scale
      nock('http://eur-ledger.example/EUR').get('').reply(200, {precision: 10, scale: 2})
      nock('http://usd-ledger.example/USD').get('').reply(200, {precision: 10, scale: 4})
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
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200, {
          source_connector_account: 'http://eur-ledger.example/accounts/mark',
          source_ledger: 'http://eur-ledger.example/EUR',
          source_amount: '100.00',
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example/USD',
          destination_amount: '105.6024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should return quotes for fixed source amounts -- lower precision destination_ledger', function * () {
      nock.cleanAll()
      // Increase scale
      nock('http://eur-ledger.example/EUR').get('').reply(200, {precision: 10, scale: 4})
      nock('http://usd-ledger.example/USD').get('').reply(200, {precision: 10, scale: 2})
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
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200, {
          source_connector_account: 'http://eur-ledger.example/accounts/mark',
          source_ledger: 'http://eur-ledger.example/EUR',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example/USD',
          destination_amount: '105.60', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('caches source and destination ledger precision', function * () {
      nock.cleanAll()
      nock('http://eur-ledger.example/EUR')
        .get('').reply(200, {precision: 10, scale: 4})
        .get('').reply(500, 'Invalid request')

      nock('http://usd-ledger.example/USD')
        .get('').reply(200, {precision: 10, scale: 4})
        .get('').reply(500, 'Invalid request')

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
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200)
        .end()

      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200)
        .end()
    })

    it('should return quotes for fixed source amounts', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200, {
          source_connector_account: 'http://eur-ledger.example/accounts/mark',
          source_ledger: 'http://eur-ledger.example/EUR',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example/USD',
          destination_amount: '105.6024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    // TODO: make sure we're calculating the rates correctly and in our favor
    it('should return quotes for fixed destination amounts', function * () {
      yield this.request()
        .get('/quote?' +
          'source_ledger=http://eur-ledger.example/EUR' +
          '&destination_amount=100' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200, {
          source_connector_account: 'http://eur-ledger.example/accounts/mark',
          source_ledger: 'http://eur-ledger.example/EUR',
          source_amount: '94.6947', // (1/ EUR/USD Rate of 1.0592) + .2% spread + round up to overestimate + slippage
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example/USD',
          destination_amount: '100.0000',
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should return a payment object with the source and destination amounts filled in as debits and credits', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200, {
          source_connector_account: 'http://eur-ledger.example/accounts/mark',
          source_ledger: 'http://eur-ledger.example/EUR',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example/USD',
          destination_amount: '105.6024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should apply the spread correctly for payments where the source asset is the counter currency in the fx rates', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://usd-ledger.example/USD' +
          '&destination_ledger=http://eur-ledger.example/EUR')
        .expect(200, {
          source_connector_account: 'http://usd-ledger.example/accounts/mark',
          source_ledger: 'http://usd-ledger.example/USD',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://eur-ledger.example/EUR',
          destination_amount: '94.1278', // 1 / (EUR/USD Rate of 1.0592 + .2% spread) - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://usd-ledger.example/USD' +
          '&destination_ledger=http://cad-ledger.example:1000/CAD')
        .expect(200, {
          source_connector_account: 'http://usd-ledger.example/accounts/mark',
          source_ledger: 'http://usd-ledger.example/USD',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://cad-ledger.example:1000/CAD',
          destination_amount: '127.8538', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates and the rate must be flipped', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example:1000/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200, {
          source_connector_account: 'http://cad-ledger.example:1000/accounts/mark',
          source_ledger: 'http://cad-ledger.example:1000/CAD',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'http://usd-ledger.example/USD',
          destination_amount: '77.7460', // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread) - slippage
          destination_expiry_duration: '5'
        })
        .end()
    })

    it('should fill in default values if no expiry_durations are specified', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example:1000/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD')
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
          '&source_ledger=http://cad-ledger.example:1000/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD' +
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
          '&source_ledger=http://cad-ledger.example:1000/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD' +
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
          '&source_ledger=http://cad-ledger.example:1000/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD' +
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
        .reply(200, {ledger: 'http://cad-ledger.example:1000/CAD'})
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_account=http://cad-ledger.example/accounts/foo' +
          '&destination_ledger=http://usd-ledger.example/USD' +
          '&source_expiry_duration=6')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_ledger).to.equal('http://cad-ledger.example:1000/CAD')
        })
        .end()
      mockGet.done()
    })

    it('should get the destination_ledger if destination_account is specified', function * () {
      const mockGet = nock('http://usd-ledger.example/accounts/foo')
        .get('')
        .reply(200, {ledger: 'http://usd-ledger.example/USD'})
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example:1000/CAD' +
          '&destination_account=http://usd-ledger.example/accounts/foo' +
          '&source_expiry_duration=6')
        .expect(200)
        .expect(function (res) {
          expect(res.body.destination_ledger).to.equal('http://usd-ledger.example/USD')
        })
        .end()
      mockGet.done()
    })

    it('returns 400 if no source is specified', function * () {
      nock('http://usd-ledger.example/accounts/foo')
        .get('')
        .reply(200, {ledger: 'http://usd-ledger.example/USD'})
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
        .reply(200, {ledger: 'http://cad-ledger.example:1000/CAD'})
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
        .reply(200, {ledger: 'http://usd-ledger.example/USD'})
      nock('http://random-ledger.example')
        .get('/accounts/bob')
        .reply(200, {ledger: 'http://random-ledger.example/'})
        .get('/')
        .reply(200, { precision: 10, scale: 4 })

      yield this.request()
        .post('/routes')
        .send([{
          source_ledger: 'http://eur-ledger.example/EUR',
          destination_ledger: 'http://random-ledger.example/',
          connector: 'http://mary.example',
          min_message_window: 1,
          source_account: 'http://eur-ledger.example/EUR/accounts/mary',
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
            source_connector_account: 'http://usd-ledger.example/accounts/mark',
            source_ledger: 'http://usd-ledger.example/USD',
            source_amount: '100.0000',
            source_expiry_duration: '7',
            destination_ledger: 'http://random-ledger.example/',
            destination_amount: '188.2556',
            destination_expiry_duration: '5'
          })
        })
        .end()
    })

    it('fails on a same-ledger payment', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=' + encodeURIComponent('http://usd-ledger.example/USD') +
          '&source_account=' + encodeURIComponent('http://usd-ledger.example/accounts/alice') +
          '&destination_ledger=' + encodeURIComponent('http://usd-ledger.example/USD') +
          '&destination_account=' + encodeURIComponent('http://usd-ledger.example/accounts/bob'))
        .expect(422)
        .expect(function (res) {
          expect(res.body.id).to.equal('AssetsNotTradedError')
          expect(res.body.message).to.match(/source_ledger must be different from destination_ledger/)
        })
    })
  })
})
