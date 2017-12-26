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
const RouteBroadcaster = require('../src/services/route-broadcaster')

const PluginMock = require('./mocks/mockPlugin')
mockRequire('ilp-plugin-mock', PluginMock)

describe('Modify Plugins', function () {
  logHelper(logger)

  beforeEach(async function () {
    appHelper.create(this)

    const testLedgers = ['cad-ledger', 'usd-ledger', 'eur-ledger', 'cny-ledger']
    _.map(testLedgers, (ledgerUri) => {
      this.accounts.getPlugin(ledgerUri).getBalance =
        function () { return Promise.resolve('150000') }
    })

    await this.backend.connect(ratesResponse)
    await this.accounts.connect()
    await this.routeBroadcaster.reloadLocalRoutes()
  })

  describe('addPlugin', function () {
    it('should add a new plugin to accounts', async function () {
      assert.equal(Object.keys(this.accounts.plugins).length, 4)
      await this.app.addPlugin('eur-ledger-2', {
        currency: 'EUR',
        currencyScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      assert.equal(Object.keys(this.accounts.plugins).length, 5)
    })

    it('should support new ledger', async function () {
      const quotePromise = this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'usd-ledger',
        destinationAccount: 'jpy-ledger.bob',
        destinationHoldDuration: 5000
      })

      await assert.isRejected(quotePromise, NoRouteFoundError, /no route found. to=jpy.ledger\.bob/)

      await this.app.addPlugin('jpy-ledger', {
        currency: 'JPY',
        currencyScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })

      const quotePromise2 = this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'usd-ledger',
        destinationAccount: 'jpy-ledger.bob',
        destinationHoldDuration: 5000
      })

      await quotePromise2

      await assert.isFulfilled(quotePromise2)
    })

    it('should add a peer for the added ledger', async function () {
      await this.app.addPlugin('eur-ledger-2', {
        currency: 'EUR',
        currencyScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'eur-ledger-2'
        }
      })

      assert.instanceOf(this.routeBroadcaster.peers.get('eur-ledger-2'), RouteBroadcaster.Peer)
    })

    it('should override the accounts.getInfo function with overrideInfo data', async function () {
      const overrideInfo = {
        minBalance: '-10',
        maxBalance: '10000',
        prefix: 'test.other.prefix',
        currencyCode: 'XYZ'
      }
      await this.app.addPlugin('eur-ledger-2', {
        currency: 'EUR',
        currencyScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'eur-ledger-2'
        },
        overrideInfo
      })

      const info = this.accounts.getInfo('eur-ledger-2')
      assert.include(info, overrideInfo)
    })
  })

  describe('removePlugin', function () {
    beforeEach(async function () {
      await this.app.addPlugin('jpy-ledger', {
        currency: 'EUR',
        currencyScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'jpy-ledger'
        }
      })
    })

    it('should remove a plugin from accounts', async function () {
      assert.isOk(this.accounts.getPlugin('jpy-ledger'))
      await this.app.removePlugin('jpy-ledger')
      assert.isNotOk(this.accounts.getPlugin('jpy-ledger'))
    })

    it('should no longer quote to that plugin', async function () {
      await this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'usd-ledger',
        destinationAccount: 'jpy-ledger.bob',
        destinationHoldDuration: 1.001
      })

      await this.app.removePlugin('jpy-ledger')

      await this.routeBuilder.quoteBySource({
        sourceAmount: '100',
        sourceAccount: 'usd-ledger',
        destinationAccount: 'jpy-ledger.bob',
        destinationHoldDuration: 1.001
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('NoRouteFoundError')
        expect(err.message).to.match(/no route found. to=jpy-ledger.bob/)
      })
    })

    it('should depeer the removed ledger', async function () {
      await this.app.removePlugin('jpy-ledger')

      assert.isNotOk(this.routeBroadcaster.peers['jpy-ledger'])
    })
  })
})
