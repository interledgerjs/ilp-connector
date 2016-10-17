'use strict'
const assert = require('chai').assert
const expect = require('chai').expect
const appHelper = require('./helpers/app')
const mockRequire = require('mock-require')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const logger = require('ilp-connector')._test.logger
const logHelper = require('./helpers/log')
const _ = require('lodash')

const PluginMock = require('./mocks/mockPlugin')
mockRequire('ilp-plugin-mock', PluginMock)

describe('Modify Plugins', function () {
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

  describe('addPlugin', function () {
    it('should add a new plugin to core', function * () {
      assert.equal(Object.keys(this.core.clients).length, 4)
      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      assert.equal(Object.keys(this.core.clients).length, 5)
    })

    it('should support new ledger', function * () {
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

      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {}
      })

      yield this.messageRouter.getQuote({
        source_amount: '100',
        source_address: 'eur-ledger-2.alice',
        destination_address: 'usd-ledger.bob',
        destination_expiry_duration: '1.001'
      })
    })
  })

  describe('removePlugin', function () {
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

      yield this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {}
      })
    })

    it('should remove a plugin from core', function * () {
      assert.isOk(this.core.getPlugin('eur-ledger-2.'))
      yield this.app.removePlugin('eur-ledger-2.')
      assert.isNotOk(this.core.getPlugin('eur-ledger-2.'))
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
  })
})
