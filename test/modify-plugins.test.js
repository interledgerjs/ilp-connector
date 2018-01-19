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
const Peer = require('../src/routing/peer').default

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
    await this.middlewareManager.setup()
  })

  describe('addPlugin', function () {
    it('should add a new plugin to accounts', async function () {
      assert.equal(this.accounts.accounts.size, 4)
      await this.app.addPlugin('eur-ledger-2', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      assert.equal(this.accounts.accounts.size, 5)
    })

    it('should support new ledger', async function () {
      const quotePromise = this.routeBuilder.quoteBySource('usd-ledger', {
        sourceAmount: '100',
        destinationAccount: 'jpy-ledger.bob',
        destinationHoldDuration: 5000
      })

      await assert.isRejected(quotePromise, NoRouteFoundError, /no route found. to=jpy.ledger\.bob/)

      await this.app.addPlugin('jpy-ledger', {
        relation: 'peer',
        assetCode: 'JPY',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })

      this.accounts.getPlugin('jpy-ledger')._dataHandler(Buffer.from(JSON.stringify({
        method: 'broadcast_routes',
        data: {
          hold_down_time: 45000,
          unreachable_through_me: [],
          request_full_table: false,
          new_routes: [{
            prefix: 'jpy-ledger',
            path: []
          }]
        }
      })))

      const quotePromise2 = this.routeBuilder.quoteBySource('usd-ledger', {
        sourceAmount: '100',
        destinationAccount: 'jpy-ledger.bob',
        destinationHoldDuration: 5000
      })

      await quotePromise2

      await assert.isFulfilled(quotePromise2)
    })

    it('should add a peer for the added ledger', async function () {
      await this.app.addPlugin('eur-ledger-2', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'eur-ledger-2'
        }
      })

      assert.instanceOf(this.routeBroadcaster.peers.get('eur-ledger-2'), Peer)
    })
  })

  describe('removePlugin', function () {
    beforeEach(async function () {
      await this.app.addPlugin('jpy-ledger', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'jpy-ledger'
        }
      })

      this.accounts.getPlugin('jpy-ledger')._dataHandler(Buffer.from(JSON.stringify({
        method: 'broadcast_routes',
        data: {
          hold_down_time: 45000,
          unreachable_through_me: [],
          request_full_table: false,
          new_routes: [{
            prefix: 'jpy-ledger',
            path: []
          }]
        }
      })))
    })

    it('should remove a plugin from accounts', async function () {
      assert.isOk(this.accounts.getPlugin('jpy-ledger'))
      await this.app.removePlugin('jpy-ledger')
      assert.throws(() => this.accounts.getPlugin('jpy-ledger'), 'unknown account id. accountId=jpy-ledger')
    })

    it('should no longer quote to that plugin', async function () {
      await this.routeBuilder.quoteBySource('usd-ledger', {
        sourceAmount: '100',
        destinationAccount: 'jpy-ledger.bob',
        destinationHoldDuration: 1.001
      })

      await this.app.removePlugin('jpy-ledger')

      await this.routeBuilder.quoteBySource('usd-ledger', {
        sourceAmount: '100',
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
