'use strict'
const chai = require('chai')
const assert = chai.assert
const expect = chai.expect
chai.use(require('chai-as-promised'))

const appHelper = require('./helpers/app')
const mockRequire = require('mock-require')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const _ = require('lodash')
const AssetsNotTradedError = require('../src/errors/assets-not-traded-error')

const PluginMock = require('./mocks/mockPlugin')
mockRequire('ilp-plugin-mock', PluginMock)

describe('Modify Plugins', function () {
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

  describe('addPlugin', function () {
    it('should add a new plugin to ledgers', function * () {
      assert.equal(Object.keys(this.ledgers._core.clients).length, 4)
      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      assert.equal(Object.keys(this.ledgers._core.clients).length, 5)
    })

    it('should support new ledger', function * () {
      const quotePromise = this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger-2.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '1.001'
      })

      yield assert.isRejected(quotePromise, AssetsNotTradedError, /This connector does not support the given asset pair/)

      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {}
      })

      const quotePromise2 = this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger-2.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '1.001'
      })

      yield assert.isFulfilled(quotePromise2)
    })

    it('should get peers on the added ledger', function * () {
      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'eur-ledger-2.'
        }
      })

      assert.isTrue(this.routeBroadcaster.peersByLedger['eur-ledger-2.']['mark'])
    })
  })

  describe('removePlugin', function () {
    beforeEach(function * () {
      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        prefix: 'eur-ledger-2.',
        options: {
          prefix: 'eur-ledger-2.'
        }
      })
    })

    it('should remove a plugin from ledgers', function * () {
      assert.isOk(this.ledgers.getPlugin('eur-ledger-2.'))
      yield this.app.removePlugin('eur-ledger-2.')
      assert.isNotOk(this.ledgers.getPlugin('eur-ledger-2.'))
    })

    it('should no longer quote to that plugin', function * () {
      yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger-2.alice',
        destination_address: 'cad-ledger.bob',
        destination_expiry_duration: '1.001'
      })

      yield this.app.removePlugin('eur-ledger-2.')

      yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger-2.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '1.001'
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('AssetsNotTradedError')
        expect(err.message).to.match(/This connector does not support the given asset pair/)
      })
    })

    it('should depeer the removed ledger', function * () {
      yield this.app.removePlugin('eur-ledger-2.')

      assert.isNotOk(this.routeBroadcaster.peersByLedger['eur-ledger-2.'])
    })
  })
})
