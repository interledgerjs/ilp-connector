'use strict'
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const config = require('../services/config')
config.tradingPairs = require('./data/tradingPairs')
const app = require('../app')
const ratesResponse = require('./data/fxRates.json')
const validate = require('five-bells-shared/services/validate')
const appHelper = require('./helpers/app')
const logger = require('../services/log')
const backend = require('../services/backend')
const logHelper = require('five-bells-shared/testHelpers/log')
const expect = require('chai').expect

describe('Quotes', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this, app)

    yield backend.connect(ratesResponse)
  })

  describe('GET /quote', function () {
    it('should return a 400 if no amount is specified', function *() {
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

    it('should return a 422 if the destination_expiry_duration is too long', function *() {
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

    it('should return a 422 if the difference between the source_expiry_duration and destination_expiry_duration is less than the minMessageWindow', function *() {
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

    it('should return a valid Payment Template object', function *() {
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

    it('should return quotes for fixed source amounts', function *() {
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
              amount: '105.71', // EUR/USD Rate of 1.0592 - .2% spread
              account: 'http://usd-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '105.71', // EUR/USD Rate of 1.0592 - .2% spread
              account: null
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    // TODO: make sure we're calculating the rates correctly and in our favor
    it('should return quotes for fixed destination amounts', function *() {
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
              amount: '94.61' // (1/ EUR/USD Rate of 1.0592) + .2% spread + round up to overestimate
            }],
            credits: [{
              account: 'http://eur-ledger.example/accounts/mark',
              amount: '94.61' // (1/ EUR/USD Rate of 1.0592) + .2% spread + round up to overestimate
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              amount: '100.00',
              account: 'http://usd-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '100.00',
              account: null
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should return a payment object with the source and destination amounts filled in as debits and credits', function *() {
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
              amount: '105.71', // EUR/USD Rate of 1.0592 - .2% spread
              account: 'http://usd-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '105.71', // EUR/USD Rate of 1.0592 - .2% spread
              account: null
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should apply the spread correctly for payments where the source asset is the counter currency in the fx rates', function *() {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://usd-ledger.example/USD' +
          '&destination_ledger=http://eur-ledger.example/EUR')
        .expect(200, {
          source_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              account: null,
              amount: '100.00'
            }],
            credits: [{
              account: 'http://usd-ledger.example/accounts/mark',
              amount: '100.00'
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://eur-ledger.example/EUR',
            debits: [{
              amount: '94.22', // 1 / (EUR/USD Rate of 1.0592 + .2% spread)
              account: 'http://eur-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '94.22', // 1 / (EUR/USD Rate of 1.0592 + .2% spread)
              account: null
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates', function *() {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://usd-ledger.example/USD' +
          '&destination_ledger=http://cad-ledger.example/CAD')
        .expect(200, {
          source_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              account: null,
              amount: '100.00'
            }],
            credits: [{
              account: 'http://usd-ledger.example/accounts/mark',
              amount: '100.00'
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://cad-ledger.example/CAD',
            debits: [{
              amount: '127.98', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread
              account: 'http://cad-ledger.example/accounts/mark'
            }],
            credits: [{
              amount: '127.98', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread
              account: null
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates and the rate must be flipped', function *() {
      yield this.request()
        .get('/quote?source_amount=100' +
          '&source_ledger=http://cad-ledger.example/CAD' +
          '&destination_ledger=http://usd-ledger.example/USD')
        .expect(200, {
          source_transfers: [{
            ledger: 'http://cad-ledger.example/CAD',
            debits: [{
              amount: '100.00',
              account: null
            }],
            credits: [{
              amount: '100.00',
              account: 'http://cad-ledger.example/accounts/mark'
            }],
            expiry_duration: '11'
          }],
          destination_transfers: [{
            ledger: 'http://usd-ledger.example/USD',
            debits: [{
              account: 'http://usd-ledger.example/accounts/mark',
              amount: '77.82' // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread)
            }],
            credits: [{
              account: null,
              amount: '77.82' // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread)
            }],
            expiry_duration: '10'
          }]
        })
        .end()
    })

    it('should fill in default values if no expiry_durations are specified', function *() {
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

    it('should return the specified expiry_durations if they are acceptable', function *() {
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

    it('should set the source_expiry_duration if only the destination_expiry_duration is specified', function *() {
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

    it('should set the destination_expiry_duration if only the source_expiry_duration is specified', function *() {
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

    it('should get the source_ledger if source_account is specified', function *() {
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

    it('should get the destination_ledger if destination_account is specified', function *() {
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
  })
})
