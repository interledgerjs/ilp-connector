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

describe('Quotes', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)

    const testLedgers = [
      'http://cad-ledger.example/CAD',
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
    _.map(testLedgers, (ledgerUri) => ledgerUri.slice(0, -4) + '/accounts/mark')
    .forEach((connector_account_uri) => {
      nock(connector_account_uri).get('')
        .reply(200, {
          name: 'mark',
          ledger: 'http://' + parseURL(connector_account_uri).host,
          balance: 150000
        })
    })
    balanceCache.reset()

    yield this.backend.connect(ratesResponse)
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
          expect(res.body.message).to.equal('Must specify either source or ' +
            'destination amount to get quote')
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
          'source_amount=150001' +
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

    it('should return a valid Payment Template object', function * () {
      yield this.request()
        .get('/quote?' +
          'source_amount=100' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(function (res) {
          let validation = validate('PaymentTemplate', res.body)
          if (!validation.valid) {
            throw new Error('Not a valid payment template')
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
          source_transfers: [{
            ledger: 'http://eur-ledger.example/EUR',
            debits: [{
              account: null,
              amount: '100.00'
            }],
            credits: [{
              account: 'http://eur-ledger.example/accounts/mark',
              amount: '100.00'
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              amount: '105.7081', // EUR/USD Rate of 1.0592 - .2% spread
              account: 'http://usd-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '105.7081', // EUR/USD Rate of 1.0592 - .2% spread
              account: null
            }],
            expiry_duration: '10'
          }]
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
          source_transfers: [{
            ledger: 'http://eur-ledger.example/EUR',
            debits: [{
              account: null,
              amount: '100.0000'
            }],
            credits: [{
              account: 'http://eur-ledger.example/accounts/mark',
              amount: '100.0000'
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              amount: '105.70', // EUR/USD Rate of 1.0592 - .2% spread
              account: 'http://usd-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '105.70', // EUR/USD Rate of 1.0592 - .2% spread
              account: null
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should return quotes for fixed source amounts', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200, {
          source_transfers: [{
            ledger: 'http://eur-ledger.example/EUR',
            debits: [{
              account: null,
              amount: '100.0000'
            }],
            credits: [{
              account: 'http://eur-ledger.example/accounts/mark',
              amount: '100.0000'
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              amount: '105.7081', // EUR/USD Rate of 1.0592 - .2% spread
              account: 'http://usd-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '105.7081', // EUR/USD Rate of 1.0592 - .2% spread
              account: null
            }],
            expiry_duration: '10'
          }]
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
          source_transfers: [{
            ledger: 'http://eur-ledger.example/EUR',
            debits: [{
              account: null,
              amount: '94.6001' // (1/ EUR/USD Rate of 1.0592) + .2% spread + round up to overestimate
            }],
            credits: [{
              account: 'http://eur-ledger.example/accounts/mark',
              amount: '94.6001' // (1/ EUR/USD Rate of 1.0592) + .2% spread + round up to overestimate
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              amount: '100.0000',
              account: 'http://usd-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '100.0000',
              account: null
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should return a payment object with the source and destination amounts filled in as debits and credits', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://eur-ledger.example/EUR' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200, {
          source_transfers: [{
            ledger: 'http://eur-ledger.example/EUR',
            debits: [{
              account: null,
              amount: '100.0000'
            }],
            credits: [{
              account: 'http://eur-ledger.example/accounts/mark',
              amount: '100.0000'
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              amount: '105.7081', // EUR/USD Rate of 1.0592 - .2% spread
              account: 'http://usd-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '105.7081', // EUR/USD Rate of 1.0592 - .2% spread
              account: null
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should apply the spread correctly for payments where the source asset is the counter currency in the fx rates', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://usd-ledger.example/USD' +
          '&destination_ledger=http://eur-ledger.example/EUR')
        .expect(200, {
          source_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              account: null,
              amount: '100.0000'
            }],
            credits: [{
              account: 'http://usd-ledger.example/accounts/mark',
              amount: '100.0000'
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://eur-ledger.example/EUR',
            debits: [{
              amount: '94.2220', // 1 / (EUR/USD Rate of 1.0592 + .2% spread)
              account: 'http://eur-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '94.2220', // 1 / (EUR/USD Rate of 1.0592 + .2% spread)
              account: null
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://usd-ledger.example/USD' +
          '&destination_ledger=http://cad-ledger.example/CAD')
        .expect(200, {
          source_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              account: null,
              amount: '100.0000'
            }],
            credits: [{
              account: 'http://usd-ledger.example/accounts/mark',
              amount: '100.0000'
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://cad-ledger.example/CAD',
            debits: [{
              amount: '127.9818', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread
              account: 'http://cad-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '127.9818', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread
              account: null
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates and the rate must be flipped', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200, {
          source_transfers: [{
            ledger: 'http://cad-ledger.example/CAD',
            debits: [{
              amount: '100.0000',
              account: null
            }],
            credits: [{
              amount: '100.0000',
              account: 'http://cad-ledger.example/accounts/mark'
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              account: 'http://usd-ledger.example/accounts/mark',
              amount: '77.8238' // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread)
            }],
            credits: [{
              account: null,
              amount: '77.8238' // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread)
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should fill in default values if no expiry_durations are specified', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_transfers[0].expiry_duration)
            .to.equal('11')
          expect(res.body.destination_transfers[0].expiry_duration)
            .to.equal('10')
        })
        .end()
    })

    it('should return the specified expiry_durations if they are acceptable', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD' +
          '&source_expiry_duration=6' +
          '&destination_expiry_duration=5')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_transfers[0].expiry_duration)
            .to.equal('6')
          expect(res.body.destination_transfers[0].expiry_duration)
            .to.equal('5')
        })
        .end()
    })

    it('should set the source_expiry_duration if only the destination_expiry_duration is specified', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD' +
          '&destination_expiry_duration=5')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_transfers[0].expiry_duration)
            .to.equal('6')
          expect(res.body.destination_transfers[0].expiry_duration)
            .to.equal('5')
        })
        .end()
    })

    it('should set the destination_expiry_duration if only the source_expiry_duration is specified', function * () {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD' +
          '&source_expiry_duration=6')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_transfers[0].expiry_duration)
            .to.equal('6')
          expect(res.body.destination_transfers[0].expiry_duration)
            .to.equal('5')
        })
        .end()
    })

    it('should get the source_ledger if source_account is specified', function * () {
      const mockGet = nock('http://cad-ledger.example/accounts/foo')
        .get('')
        .reply(200, {ledger: 'http://cad-ledger.example/CAD'})
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_account=http://cad-ledger.example/accounts/foo' +
          '&destination_ledger=http://usd-ledger.example/USD' +
          '&source_expiry_duration=6')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_transfers[0].debits[0].account).to.equal('http://cad-ledger.example/accounts/foo')
          expect(res.body.destination_transfers[0].credits[0].account).to.equal(null)
          expect(res.body.source_transfers[0].ledger).to.equal('http://cad-ledger.example/CAD')
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
          '&source_ledger=http://cad-ledger.example/CAD' +
          '&destination_account=http://usd-ledger.example/accounts/foo' +
          '&source_expiry_duration=6')
        .expect(200)
        .expect(function (res) {
          expect(res.body.source_transfers[0].debits[0].account).to.equal(null)
          expect(res.body.destination_transfers[0].credits[0].account).to.equal('http://usd-ledger.example/accounts/foo')
          expect(res.body.destination_transfers[0].ledger).to.equal('http://usd-ledger.example/USD')
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
        .reply(200, {ledger: 'http://cad-ledger.example/CAD'})
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
  })
})
