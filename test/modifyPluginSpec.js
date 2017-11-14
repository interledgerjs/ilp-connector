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
const NoRouteFoundError = require('../src/errors/no-route-found-error')

const PluginMock = require('./mocks/mockPlugin')
mockRequire('ilp-plugin-mock', PluginMock)

describe('Modify Plugins', function () {
  logHelper(logger)

  beforeEach(async function () {
    appHelper.create(this)

    const testLedgers = ['cad-ledger.', 'usd-ledger.', 'eur-ledger.', 'cny-ledger.']
    _.map(testLedgers, (ledgerUri) => {
      this.ledgers.getPlugin(ledgerUri).getBalance =
        function () { return Promise.resolve('150000') }
    })

    await this.backend.connect(ratesResponse)
    await this.ledgers.connect()
    await this.routeBroadcaster.reloadLocalRoutes()
  })

  describe('addPlugin', function () {
    it('should add a new plugin to ledgers', async function () {
      assert.equal(Object.keys(this.ledgers.plugins).length, 4)
      await this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      assert.equal(Object.keys(this.ledgers.plugins).length, 5)
    })

    it('should support new ledger', async function () {
      const quotePromise = this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'eur-ledger-2.alice',
        destinationAccount: 'usd-ledger.bob',
        destinationHoldDuration: 5000
      })

      await assert.isRejected(quotePromise, NoRouteFoundError, /No route found from: eur-ledger-2\.alice to: usd-ledger\.bob/)

      await this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {}
      })

      const quotePromise2 = this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'eur-ledger-2.alice',
        destinationAccount: 'usd-ledger.bob',
        destinationHoldDuration: 5000
      })

      await assert.isFulfilled(quotePromise2)
    })

    it('should get peers on the added ledger', async function () {
      await this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'eur-ledger-2.'
        }
      })

      assert.isTrue(this.routeBroadcaster.peersByLedger['eur-ledger-2.']['mark'])
    })

    it('should override the plugin.getInfo function with overrideInfo data', async function () {
      const overrideInfo = {
        minBalance: '-10',
        maxBalance: '10000',
        prefix: 'test.other.prefix.',
        currencyCode: 'XYZ',
        currencyScale: 0
      }
      await this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'eur-ledger-2.'
        },
        overrideInfo
      })

      const info = this.ledgers.plugins['eur-ledger-2.'].getInfo()
      assert.include(info, overrideInfo)
    })
  })

  describe('removePlugin', function () {
    beforeEach(async function () {
      await this.app.addPlugin('eur-ledger-2.', {
        currency: 'EUR',
        plugin: 'ilp-plugin-mock',
        prefix: 'eur-ledger-2.',
        options: {
          prefix: 'eur-ledger-2.'
        }
      })
    })

    it('should remove a plugin from ledgers', async function () {
      assert.isOk(this.ledgers.getPlugin('eur-ledger-2.'))
      await this.app.removePlugin('eur-ledger-2.')
      assert.isNotOk(this.ledgers.getPlugin('eur-ledger-2.'))
    })

    it('should no longer quote to that plugin', async function () {
      await this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'eur-ledger-2.alice',
        destinationAccount: 'cad-ledger.bob',
        destinationHoldDuration: 1.001
      })

      await this.app.removePlugin('eur-ledger-2.')

      await this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'eur-ledger-2.alice',
        destinationAccount: 'usd-ledger.bob',
        destinationHoldDuration: 1.001
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('NoRouteFoundError')
        expect(err.message).to.match(/No route found from: eur-ledger-2\.alice to: usd-ledger\.bob/)
      })
    })

    it('should depeer the removed ledger', async function () {
      await this.app.removePlugin('eur-ledger-2.')

      assert.isNotOk(this.routeBroadcaster.peersByLedger['eur-ledger-2.'])
    })
  })
})
