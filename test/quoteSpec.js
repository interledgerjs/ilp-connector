'use strict'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const validate = require('../src/lib/validate').validate
const appHelper = require('./helpers/app')
const logger = require('ilp-connector')._test.logger
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
    yield this.core.connect()
    yield this.routeBroadcaster.reloadLocalRoutes()
  })

  afterEach(function () {
    nock.cleanAll()
  })

  describe('MessageRouter#getQuote', function () {
    it('should return a NoAmountSpecifiedError if no amount is specified', function (done) {
      this.messageRouter.getQuote({
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('NoAmountSpecifiedError')
        expect(err.message).to.equal('Exactly one of source_amount or destination_amount must be specified')
        done()
      }).catch(done)
    })

    it('should return a InvalidBodyError if both source_amount and destination_amount are specified', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        destination_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('InvalidBodyError')
        expect(err.message).to.equal('Exactly one of source_amount or destination_amount must be specified')
        done()
      }).catch(done)
    })

    it('should return a InvalidAmountSpecifiedError if source_amount is zero', function (done) {
      this.messageRouter.getQuote({
        source_amount: '0',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('InvalidAmountSpecifiedError')
        expect(err.message).to.equal('source_amount must be finite and positive')
        done()
      }).catch(done)
    })

    it('should return a InvalidAmountSpecifiedError if destination_amount is zero', function (done) {
      this.messageRouter.getQuote({
        destination_amount: '0',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('InvalidAmountSpecifiedError')
        expect(err.message).to.equal('destination_amount must be finite and positive')
        done()
      }).catch(done)
    })

    it('should return a InvalidAmountSpecifiedError if source_amount isNan', function (done) {
      this.messageRouter.getQuote({
        source_amount: 'foo',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('InvalidAmountSpecifiedError')
        expect(err.message).to.equal('source_amount must be finite and positive')
        done()
      }).catch(done)
    })

    it('should return a InvalidAmountSpecifiedError if destination_amount isNan', function (done) {
      this.messageRouter.getQuote({
        destination_amount: 'foo',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('InvalidAmountSpecifiedError')
        expect(err.message).to.equal('destination_amount must be finite and positive')
        done()
      }).catch(done)
    })

    it('should return a InvalidAmountSpecifiedError if source_amount is negative', function (done) {
      this.messageRouter.getQuote({
        source_amount: '-1.3',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('InvalidAmountSpecifiedError')
        expect(err.message).to.equal('source_amount must be finite and positive')
        done()
      }).catch(done)
    })

    it('should return a InvalidAmountSpecifiedError if destination_amount is negative', function (done) {
      this.messageRouter.getQuote({
        destination_amount: '-1.4',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('InvalidAmountSpecifiedError')
        expect(err.message).to.equal('destination_amount must be finite and positive')
        done()
      }).catch(done)
    })

    it('should return AssetsNotTradedError when the source ledger is not supported', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'http://fake-ledger.example/EUR',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '1.001'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('AssetsNotTradedError')
        expect(err.message).to.equal('This connector does not support the given asset pair')
        done()
      }).catch(done)
    })

    it('should return a UnacceptableAmountError if destination_address rounded amount is less than or equal to 0', function (done) {
      this.messageRouter.getQuote({
        source_amount: '0.00001',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('UnacceptableAmountError')
        expect(err.message).to.equal('Quoted destination is lower than minimum amount allowed')
        done()
      }).catch(done)
    })

    it('should return AssetsNotTradedError when the destination ledger is not supported', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'http://fake-ledger.example/USD',
        destination_expiry_duration: '1.001'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('AssetsNotTradedError')
        expect(err.message).to.equal('This connector does not support the given asset pair')
        done()
      }).catch(done)
    })

    it('should return a UnacceptableExpiryError if the destination_expiry_duration is too long', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '10.001'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('UnacceptableExpiryError')
        expect(err.message).to.match(/Destination expiry duration is too long/)
        done()
      }).catch(done)
    })

    it('should return a UnacceptableExpiryError if the difference between the source_expiry_duration and destination_expiry_duration is less than the minMessageWindow', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '10',
        source_expiry_duration: '10.999'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('UnacceptableExpiryError')
        expect(err.message).to.equal('The difference between the ' +
          'destination expiry duration and the source expiry duration is ' +
          'insufficient to ensure that we can execute the source transfers')
        done()
      }).catch(done)
    })

    it('should not return an Error for insufficient liquidity', function (done) {
      this.messageRouter.getQuote({
        destination_amount: '150001',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '10'
      }).then(() => {
        done()
      })
        .catch(done)
    })

    it('should return a ExternalError when unable to get precision from source_address', function (done) {
      this.infoCache.reset()
      nock.cleanAll()
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { throw new ExternalError() }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }

      this.messageRouter.getQuote({
        source_amount: '1500001',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '10'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('ExternalError')
        done()
      }).catch(done)
    })

    it('should return a ExternalError when unable to get precision from destination_address', function (done) {
      this.infoCache.reset()
      nock.cleanAll()
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { throw new ExternalError() }

      this.messageRouter.getQuote({
        source_amount: '1500001',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '10'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('ExternalError')
        done()
      }).catch(done)
    })

    it('should not return an Error when unable to get balance from ledger', function (done) {
      this.infoCache.reset()
      nock.cleanAll()
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.core.getPlugin('usd-ledger.')
        .getBalance = function * () { throw new ExternalError() }

      this.messageRouter.getQuote({
        source_amount: '1500001',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '10'
      }).then(() => {
        done()
      })
        .catch(done)
    })

    it('should return a valid Quote object', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        validate('Quote', quote)
        done()
      }).catch(done)
    })

    it('should return quotes for fixed source amounts -- lower precision source_address', function (done) {
      this.infoCache.reset()
      nock.cleanAll()
      // Increase scale
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 4} }

      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        expect(quote).to.deep.equal({
          source_connector_account: 'eur-ledger.mark',
          source_ledger: 'eur-ledger.',
          source_amount: '100.00',
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '105.6024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        done()
      }).catch(done)
    })

    it('should return quotes for fixed source amounts -- lower precision destination_address', function (done) {
      this.infoCache.reset()
      nock.cleanAll()
      // Increase scale
      this.core.getPlugin('eur-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 4} }
      this.core.getPlugin('usd-ledger.')
        .getInfo = function * () { return {precision: 10, scale: 2} }

      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        expect(quote).to.deep.equal({
          source_connector_account: 'eur-ledger.mark',
          source_ledger: 'eur-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '105.60', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        done()
      }).catch(done)
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

      yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })
    })

    it('should return quotes for fixed source amounts', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        expect(quote).to.deep.equal({
          source_connector_account: 'eur-ledger.mark',
          source_ledger: 'eur-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '105.6024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        done()
      }).catch(done)
    })

    // TODO: make sure we're calculating the rates correctly and in our favor
    it('should return quotes for fixed destination amounts', function (done) {
      this.messageRouter.getQuote({
        source_address: 'eur-ledger.alice',
        destination_amount: '100',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        expect(quote).to.deep.equal({
          source_connector_account: 'eur-ledger.mark',
          source_ledger: 'eur-ledger.',
          source_amount: '94.6947', // (1/ EUR/USD Rate of 1.0592) + .2% spread + round up to overestimate + slippage
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '100.0000',
          destination_expiry_duration: '5'
        })
        done()
      }).catch(done)
    })

    it('should return a payment object with the source and destination amounts filled in as debits and credits', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        expect(quote).to.deep.equal({
          source_connector_account: 'eur-ledger.mark',
          source_ledger: 'eur-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '105.6024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        done()
      }).catch(done)
    })

    it('should apply the spread correctly for payments where the source asset is the counter currency in the fx rates', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'usd-ledger.bob',
        destination_address: 'eur-ledger.alice'
      }).then((quote) => {
        expect(quote).to.deep.equal({
          source_connector_account: 'usd-ledger.mark',
          source_ledger: 'usd-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'eur-ledger.',
          destination_amount: '94.1278', // 1 / (EUR/USD Rate of 1.0592 + .2% spread) - slippage
          destination_expiry_duration: '5'
        })
        done()
      }).catch(done)
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'usd-ledger.bob',
        destination_address: 'cad-ledger.carl'
      }).then((quote) => {
        expect(quote).to.deep.equal({
          source_connector_account: 'usd-ledger.mark',
          source_ledger: 'usd-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'cad-ledger.',
          destination_amount: '127.8538', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread - slippage
          destination_expiry_duration: '5'
        })
        done()
      }).catch(done)
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates and the rate must be flipped', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.carl',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        expect(quote).to.deep.equal({
          source_connector_account: 'cad-ledger.mark',
          source_ledger: 'cad-ledger.',
          source_amount: '100.0000',
          source_expiry_duration: '6',
          destination_ledger: 'usd-ledger.',
          destination_amount: '77.7460', // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread) - slippage
          destination_expiry_duration: '5'
        })
        done()
      }).catch(done)
    })

    it('should fill in default values if no expiry_durations are specified', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.carl',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        expect(quote.source_expiry_duration).to.equal('6')
        expect(quote.destination_expiry_duration).to.equal('5')
        done()
      }).catch(done)
    })

    it('should return the specified expiry_durations if they are acceptable', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.carl',
        destination_address: 'usd-ledger.bob',
        source_expiry_duration: '6',
        destination_expiry_duration: '5'
      }).then((quote) => {
        expect(quote.source_expiry_duration).to.equal('6')
        expect(quote.destination_expiry_duration).to.equal('5')
        done()
      }).catch(done)
    })

    it('should set the source_expiry_duration if only the destination_expiry_duration is specified', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.carl',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '5'
      }).then((quote) => {
        expect(quote.source_expiry_duration).to.equal('6')
        expect(quote.destination_expiry_duration).to.equal('5')
        done()
      }).catch(done)
    })

    it('should set the destination_expiry_duration if only the source_expiry_duration is specified', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.carl',
        destination_address: 'usd-ledger.bob',
        source_expiry_duration: '6'
      }).then((quote) => {
        expect(quote.source_expiry_duration).to.equal('6')
        expect(quote.destination_expiry_duration).to.equal('5')
        done()
      }).catch(done)
    })

    it('returns InvalidBodyError if no source is specified', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        destination_address: 'usd-ledger.foo',
        source_expiry_duration: '6'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('InvalidBodyError')
        expect(err.message).to.equal('Missing required parameter: source_address')
        done()
      }).catch(done)
    })

    it('returns InvalidBodyError if no destination is specified', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.foo',
        source_expiry_duration: '6'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('InvalidBodyError')
        expect(err.message).to.equal('Missing required parameter: destination_address')
        done()
      }).catch(done)
    })

    it('quotes a multi-hop route', function * () {
      yield this.messageRouter.receiveRoutes([{
        source_ledger: 'eur-ledger.',
        destination_ledger: 'random-ledger.',
        min_message_window: 1,
        source_account: 'eur-ledger.mary',
        points: [ [0, 0], [10000, 20000] ]
      }], 'eur-ledger.mary')

      const quote = yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'usd-ledger.alice',
        destination_address: 'random-ledger.bob',
        destination_precision: '10',
        destination_scale: '4'
      })
      expect(quote).to.deep.equal({
        source_connector_account: 'usd-ledger.mark',
        source_ledger: 'usd-ledger.',
        source_amount: '100.0000',
        source_expiry_duration: '7',
        destination_ledger: 'random-ledger.',
        destination_amount: '188.2556',
        destination_expiry_duration: '5'
      })
    })

    it('fails on a same-ledger quote', function (done) {
      this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'usd-ledger.alice',
        destination_address: 'usd-ledger.bob'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('AssetsNotTradedError')
        expect(err.message).to.equal('This connector does not support the given asset pair')
        done()
      }).catch(done)
    })

    it('fails when the source ledger connection is closed', function (done) {
      this.core.getPlugin('eur-ledger.').connected = false
      this.messageRouter.getQuote({
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_amount: '100'
      }).then(() => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('LedgerNotConnectedError')
        expect(err.message).to.equal('No connection to ledger "eur-ledger."')
        done()
      }).catch(done)
    })

    it('fails when the destination ledger connection is closed', function (done) {
      this.core.getPlugin('usd-ledger.').connected = false
      this.messageRouter.getQuote({
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_amount: '100'
      }).then(() => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('LedgerNotConnectedError')
        expect(err.message).to.equal('No connection to ledger "usd-ledger."')
        done()
      }).catch(done)
    })
  })
})
