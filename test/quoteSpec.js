'use strict'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const validate = require('../src/lib/validate').validate
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const chai = require('chai')
const assert = chai.assert
const expect = chai.expect
chai.use(require('chai-as-promised'))
const _ = require('lodash')
const ExternalError = require('../src/errors/external-error')
const InvalidAmountSpecifiedError = require('../src/errors/invalid-amount-specified-error')
const NoAmountSpecifiedError = require('../src/errors/no-amount-specified-error')
const AssetsNotTradedError = require('../src/errors/assets-not-traded-error')
const NoRouteFoundError = require('../src/errors/no-route-found-error')
const UnacceptableAmountError = require('../src/errors/unacceptable-amount-error')
const UnacceptableExpiryError = require('../src/errors/unacceptable-expiry-error')
const LedgerNotConnectedError = require('../src/errors/ledger-not-connected-error')
const InvalidBodyError = require('five-bells-shared').InvalidBodyError

describe('Quotes', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)

    const testLedgers = ['cad-ledger.', 'usd-ledger.', 'eur-ledger.', 'cny-ledger.']
    _.map(testLedgers, (ledgerUri) => {
      this.ledgers.getPlugin(ledgerUri).getBalance =
        function * () { return '150000' }
    })

    // Reset before and after just in case a test wants to change the precision.
    this.balanceCache.reset()
    yield this.backend.connect(ratesResponse)
    yield this.ledgers.connect()
    yield this.routeBroadcaster.reloadLocalRoutes()
  })

  afterEach(function () {
    nock.cleanAll()
  })

  describe('MessageRouter#getQuote', function () {
    it('should return a NoAmountSpecifiedError if no amount is specified', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield assert.isRejected(quotePromise, NoAmountSpecifiedError, 'Exactly one of source_amount or destination_amount must be specified')
    })

    it('should return a InvalidBodyError if both source_amount and destination_amount are specified', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '100',
        destination_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield assert.isRejected(quotePromise, InvalidBodyError, 'Exactly one of source_amount or destination_amount must be specified')
    })

    it('should return a InvalidAmountSpecifiedError if source_amount is zero', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '0',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield assert.isRejected(quotePromise, InvalidAmountSpecifiedError, 'source_amount must be finite and positive')
    })

    it('should return a InvalidAmountSpecifiedError if destination_amount is zero', function * () {
      const quotePromise = this.messageRouter.getQuote({
        destination_amount: '0',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield assert.isRejected(quotePromise, InvalidAmountSpecifiedError, 'destination_amount must be finite and positive')
    })

    it('should return a InvalidAmountSpecifiedError if source_amount isNan', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: 'foo',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield assert.isRejected(quotePromise, InvalidAmountSpecifiedError, 'source_amount must be finite and positive')
    })

    it('should return a InvalidAmountSpecifiedError if destination_amount isNan', function * () {
      const quotePromise = this.messageRouter.getQuote({
        destination_amount: 'foo',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield assert.isRejected(quotePromise, InvalidAmountSpecifiedError, 'destination_amount must be finite and positive')
    })

    it('should return a InvalidAmountSpecifiedError if source_amount is negative', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '-1.3',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield assert.isRejected(quotePromise, InvalidAmountSpecifiedError, 'source_amount must be finite and positive')
    })

    it('should return a InvalidAmountSpecifiedError if destination_amount is negative', function * () {
      const quotePromise = this.messageRouter.getQuote({
        destination_amount: '-1.4',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield assert.isRejected(quotePromise, InvalidAmountSpecifiedError, 'destination_amount must be finite and positive')
    })

    it('should return NoRouteFoundError when the source ledger is not supported', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'fake-ledger.foley',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '1.001'
      })

      yield assert.isRejected(quotePromise, NoRouteFoundError, 'No route found from: fake-ledger.foley to: usd-ledger.bob')
    })

    // This test doesn't currently pass - I think it's because the connector is
    // smart enough to construct a route of A -> B -> C through itself, even if
    // A -> C isn't a pair, but A -> B and B -> C are.
    //
    // This might actually be the desired behavior... if we're willing to trade
    // A for B and B for C, we're implicitly willing to trade A for C.
    it.skip('should return AssetsNotTradedError when the pair is not supported', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.bob',
        destination_address: 'cny-ledger.bob',
        destination_expiry_duration: '1.001'
      })

      yield assert.isRejected(quotePromise, AssetsNotTradedError, 'This connector does not support the given asset pair')
    })

    it('should return a UnacceptableAmountError if destination_address rounded amount is less than or equal to 0', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '0.00001',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield assert.isRejected(quotePromise, UnacceptableAmountError, 'Quoted destination is lower than minimum amount allowed')
    })

    it('should return NoRouteFoundError when the destination ledger is not supported', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'example.fake.blah',
        destination_expiry_duration: '1.001'
      })

      yield assert.isRejected(quotePromise, NoRouteFoundError, 'No route found from: eur-ledger.alice to: example.fake.blah')
    })

    it('should return a UnacceptableExpiryError if the destination_expiry_duration is too long', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '10.001'
      })

      yield assert.isRejected(quotePromise, UnacceptableExpiryError, /Destination expiry duration is too long/)
    })

    it('should return a UnacceptableExpiryError if the difference between the source_expiry_duration and destination_expiry_duration is less than the minMessageWindow', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '10',
        source_expiry_duration: '10.999'
      })

      yield assert.isRejected(quotePromise, UnacceptableExpiryError, 'The difference between the ' +
          'destination expiry duration and the source expiry duration is ' +
          'insufficient to ensure that we can execute the source transfers')
    })

    it('should not return an Error for insufficient liquidity', function * () {
      const quotePromise = this.messageRouter.getQuote({
        destination_amount: '150001',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '10'
      })

      yield assert.isFulfilled(quotePromise)
    })

    it('should not return an Error when unable to get balance from ledger', function * () {
      nock.cleanAll()
      this.ledgers.getPlugin('eur-ledger.')
        .getInfo = function () { return {precision: 10, scale: 2} }
      this.ledgers.getPlugin('usd-ledger.')
        .getInfo = function () { return {precision: 10, scale: 2} }
      this.ledgers.getPlugin('usd-ledger.')
        .getBalance = function * () { throw new ExternalError() }

      const quotePromise = this.messageRouter.getQuote({
        source_amount: '1500001',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '10'
      })

      yield assert.isFulfilled(quotePromise)
    })

    it('should return a valid Quote object', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      validate('Quote', quote)
    })

    it('should return quotes for fixed source amounts -- lower precision source_address', function * () {
      nock.cleanAll()
      // Increase scale
      this.ledgers.getPlugin('eur-ledger.')
        .getInfo = function () { return {precision: 10, scale: 2} }
      this.ledgers.getPlugin('usd-ledger.')
        .getInfo = function () { return {precision: 10, scale: 4} }

      const quote = yield this.messageRouter.getQuote({
        source_amount: '1000000',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      expect(quote).to.deep.equal({
        source_connector_account: 'eur-ledger.mark',
        source_ledger: 'eur-ledger.',
        source_amount: '1000000',
        source_expiry_duration: '6',
        destination_ledger: 'usd-ledger.',
        destination_amount: '1056024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
        destination_expiry_duration: '5',
        liquidity_curve: [ [999.9999999999999, 0], [1000000000000, 1057081598942.9186] ]
      })
    })

    it('should return quotes for fixed source amounts -- lower precision destination_address', function * () {
      nock.cleanAll()
      // Increase scale
      this.ledgers.getPlugin('eur-ledger.')
        .getInfo = function () { return {precision: 10, scale: 4} }
      this.ledgers.getPlugin('usd-ledger.')
        .getInfo = function () { return {precision: 10, scale: 2} }

      const quote = yield this.messageRouter.getQuote({
        source_amount: '10000',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })
      expect(quote).to.deep.equal({
        source_connector_account: 'eur-ledger.mark',
        source_ledger: 'eur-ledger.',
        source_amount: '10000',
        source_expiry_duration: '6',
        destination_ledger: 'usd-ledger.',
        destination_amount: '10560', // EUR/USD Rate of 1.0592 - .2% spread - slippage
        destination_expiry_duration: '5',
        liquidity_curve: [ [10, 0], [1000000000000, 1057081599989.4293] ]
      })
    })

    it('caches source and destination ledger precision', function * () {
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

    it('should return quotes for fixed source amounts', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_amount: '1000000',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      expect(quote).to.deep.equal({
        source_connector_account: 'eur-ledger.mark',
        source_ledger: 'eur-ledger.',
        source_amount: '1000000',
        source_expiry_duration: '6',
        destination_ledger: 'usd-ledger.',
        destination_amount: '1056024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
        destination_expiry_duration: '5',
        liquidity_curve: [ [999.9999999999999, 0], [1000000000000, 1057081598942.9186] ]
      })
    })

    // TODO: make sure we're calculating the rates correctly and in our favor
    it('should return quotes for fixed destination amounts', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_address: 'eur-ledger.alice',
        destination_amount: '1000000',
        destination_address: 'usd-ledger.bob'
      })
      expect(quote).to.deep.equal({
        source_connector_account: 'eur-ledger.mark',
        source_ledger: 'eur-ledger.',
        source_amount: '946947', // (1/ EUR/USD Rate of 1.0592) + .2% spread + round up to overestimate + slippage
        source_expiry_duration: '6',
        destination_ledger: 'usd-ledger.',
        destination_amount: '1000000',
        destination_expiry_duration: '5',
        liquidity_curve: [ [946.0007628550151, 0], [1000000000946.0007, 1057081600000.0001] ]
      })
    })

    it('should return a payment object with the source and destination amounts filled in as debits and credits', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_amount: '1000000',
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })
      expect(quote).to.deep.equal({
        source_connector_account: 'eur-ledger.mark',
        source_ledger: 'eur-ledger.',
        source_amount: '1000000',
        source_expiry_duration: '6',
        destination_ledger: 'usd-ledger.',
        destination_amount: '1056024', // EUR/USD Rate of 1.0592 - .2% spread - slippage
        destination_expiry_duration: '5',
        liquidity_curve: [ [999.9999999999999, 0], [1000000000000, 1057081598942.9186] ]
      })
    })

    it('should apply the spread correctly for payments where the source asset is the counter currency in the fx rates', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_amount: '1000000',
        source_address: 'usd-ledger.bob',
        destination_address: 'eur-ledger.alice'
      })
      expect(quote).to.deep.equal({
        source_connector_account: 'usd-ledger.mark',
        source_ledger: 'usd-ledger.',
        source_amount: '1000000',
        source_expiry_duration: '6',
        destination_ledger: 'eur-ledger.',
        destination_amount: '941278', // 1 / (EUR/USD Rate of 1.0592 + .2% spread) - slippage
        destination_expiry_duration: '5',
        liquidity_curve: [ [1000.0000000000001, 0], [1000000000000, 942220542864.426] ]
      })
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_amount: '1000000',
        source_address: 'usd-ledger.bob',
        destination_address: 'cad-ledger.carl'
      })
      expect(quote).to.deep.equal({
        source_connector_account: 'usd-ledger.mark',
        source_ledger: 'usd-ledger.',
        source_amount: '1000000',
        source_expiry_duration: '6',
        destination_ledger: 'cad-ledger.',
        destination_amount: '1278538', // USD/CAD Rate (1.3583 / 1.0592) - .2% spread - slippage
        destination_expiry_duration: '5',
        liquidity_curve: [ [999.9999999999999, 0], [1000000000000, 1279818163372.7498] ]
      })
    })

    it('should determine the correct rate and spread when neither the source nor destination asset is the base currency in the rates and the rate must be flipped', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_amount: '1000000',
        source_address: 'cad-ledger.carl',
        destination_address: 'usd-ledger.bob'
      })
      expect(quote).to.deep.equal({
        source_connector_account: 'cad-ledger.mark',
        source_ledger: 'cad-ledger.',
        source_amount: '1000000',
        source_expiry_duration: '6',
        destination_ledger: 'usd-ledger.',
        destination_amount: '777460', // 1/(USD/CAD Rate (1.3583 / 1.0592) + .2% spread) - slippage
        destination_expiry_duration: '5',
        liquidity_curve: [ [1000.0000000000002, 0], [1000000000000, 778238679925.5823] ]
      })
    })

    it('should fill in default values if no expiry_durations are specified', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.carl',
        destination_address: 'usd-ledger.bob'
      })
      expect(quote.source_expiry_duration).to.equal('6')
      expect(quote.destination_expiry_duration).to.equal('5')
    })

    it('should return the specified expiry_durations if they are acceptable', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.carl',
        destination_address: 'usd-ledger.bob',
        source_expiry_duration: '6',
        destination_expiry_duration: '5'
      })
      expect(quote.source_expiry_duration).to.equal('6')
      expect(quote.destination_expiry_duration).to.equal('5')
    })

    it('should set the source_expiry_duration if only the destination_expiry_duration is specified', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.carl',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '5'
      })
      expect(quote.source_expiry_duration).to.equal('6')
      expect(quote.destination_expiry_duration).to.equal('5')
    })

    it('should set the destination_expiry_duration if only the source_expiry_duration is specified', function * () {
      const quote = yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.carl',
        destination_address: 'usd-ledger.bob',
        source_expiry_duration: '6'
      })
      expect(quote.source_expiry_duration).to.equal('6')
      expect(quote.destination_expiry_duration).to.equal('5')
    })

    it('returns InvalidBodyError if no source is specified', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '100',
        destination_address: 'usd-ledger.foo',
        source_expiry_duration: '6'
      })

      yield assert.isRejected(quotePromise, InvalidBodyError, 'Missing required parameter: source_address')
    })

    it('returns InvalidBodyError if no destination is specified', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'cad-ledger.foo',
        source_expiry_duration: '6'
      })

      yield assert.isRejected(quotePromise, InvalidBodyError, 'Missing required parameter: destination_address')
    })

    // the functionality this tests has been disabled, maybe only temporarily
    it.skip('quotes a multi-hop route', function * () {
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
        destination_expiry_duration: '5',
        liquidity_curve: [ [0.1, 0], [10613.226452905812, 19999.81155589124] ]
      })
    })

    it('fails on a same-ledger quote', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'usd-ledger.alice',
        destination_address: 'usd-ledger.bob'
      })

      yield assert.isRejected(quotePromise, NoRouteFoundError, 'No route found from: usd-ledger.alice to: usd-ledger.bob')
    })

    it('fails when the source ledger connection is closed', function * () {
      this.ledgers.getPlugin('eur-ledger.').connected = false
      const quotePromise = this.messageRouter.getQuote({
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_amount: '100'
      })

      yield assert.isRejected(quotePromise, LedgerNotConnectedError, 'No connection to ledger "eur-ledger."')
    })

    it('fails when the destination ledger connection is closed', function * () {
      this.ledgers.getPlugin('usd-ledger.').connected = false
      const quotePromise = this.messageRouter.getQuote({
        source_address: 'eur-ledger.alice',
        destination_address: 'usd-ledger.bob',
        destination_amount: '100'
      })

      yield assert.isRejected(quotePromise, LedgerNotConnectedError, 'No connection to ledger "usd-ledger."')
    })
  })
})
