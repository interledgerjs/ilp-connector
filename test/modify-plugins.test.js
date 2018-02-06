'use strict'
const chai = require('chai')
const assert = chai.assert
const expect = chai.expect
chai.use(require('chai-as-promised'))

const appHelper = require('./helpers/app')
const mockRequire = require('mock-require')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const NoRouteFoundError = require('../src/errors/no-route-found-error')
const Peer = require('../src/routing/peer').default

const PluginMock = require('./mocks/mockPlugin')
mockRequire('ilp-plugin-mock', PluginMock)

describe('Modify Plugins', function () {
  logHelper(logger)

  beforeEach(async function () {
    appHelper.create(this)

    await this.backend.connect()
    await this.accounts.connect()
    await this.routeBroadcaster.reloadLocalRoutes()
    await this.middlewareManager.setup()
  })

  describe('addPlugin', function () {
    it('should add a new plugin to accounts', async function () {
      assert.equal(this.accounts.accounts.size, 4)
      await this.app.addPlugin('test.eur-ledger-2', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })
      assert.equal(this.accounts.accounts.size, 5)
    })

    it('should support new ledger', async function () {
      const quotePromise = this.routeBuilder.quoteBySource('test.usd-ledger', {
        sourceAmount: '100',
        destinationAccount: 'test.jpy-ledger.bob',
        destinationHoldDuration: 5000
      })

      await assert.isRejected(quotePromise, NoRouteFoundError, /no route found. to=test.jpy.ledger\.bob/)

      await this.app.addPlugin('test.jpy-ledger', {
        relation: 'peer',
        assetCode: 'JPY',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {}
      })

      this.accounts.getPlugin('test.jpy-ledger').sendData = () => Buffer.alloc(0)

      await this.accounts.getPlugin('test.jpy-ledger')._dataHandler(Buffer.from(JSON.stringify({
        method: 'broadcast_routes',
        data: {
          speaker: 'test.jpy-ledger',
          routing_table_id: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
          from_epoch: 0,
          to_epoch: 1,
          hold_down_time: 45000,
          withdrawn_routes: [],
          new_routes: [{
            prefix: 'test.jpy-ledger',
            path: ['test.jpy-ledger'],
            auth: 'RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk='
          }]
        }
      })))

      const quotePromise2 = this.routeBuilder.quoteBySource('test.usd-ledger', {
        sourceAmount: '100',
        destinationAccount: 'test.jpy-ledger.bob',
        destinationHoldDuration: 5000
      })

      await quotePromise2

      await assert.isFulfilled(quotePromise2)
    })

    it('should add a peer for the added ledger', async function () {
      await this.app.addPlugin('test.eur-ledger-2', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'eur-ledger-2'
        }
      })

      assert.instanceOf(this.routeBroadcaster.peers.get('test.eur-ledger-2'), Peer)
    })
  })

  describe('removePlugin', function () {
    beforeEach(async function () {
      await this.app.addPlugin('test.jpy-ledger', {
        relation: 'peer',
        assetCode: 'EUR',
        assetScale: 4,
        plugin: 'ilp-plugin-mock',
        options: {
          prefix: 'jpy-ledger'
        }
      })

      this.accounts.getPlugin('test.jpy-ledger')._dataHandler(Buffer.from(JSON.stringify({
        method: 'broadcast_routes',
        data: {
          speaker: 'test.jpy-ledger',
          routing_table_id: 'b38e6e41-71a0-4088-baed-d2f09caa18ee',
          from_epoch: 0,
          to_epoch: 1,
          hold_down_time: 45000,
          withdrawn_routes: [],
          new_routes: [{
            prefix: 'test.jpy-ledger',
            path: ['test.jpy-ledger'],
            auth: 'RLQ3sZWn8Y5TSNJM9qXszfxVlcuERxsxpy+7RhaUadk='
          }]
        }
      })))
    })

    it('should remove a plugin from accounts', async function () {
      assert.isOk(this.accounts.getPlugin('test.jpy-ledger'))
      await this.app.removePlugin('test.jpy-ledger')
      assert.throws(() => this.accounts.getPlugin('test.jpy-ledger'), 'unknown account id. accountId=test.jpy-ledger')
    })

    it('should no longer quote to that plugin', async function () {
      await this.routeBuilder.quoteBySource('test.usd-ledger', {
        sourceAmount: '100',
        destinationAccount: 'test.jpy-ledger.bob',
        destinationHoldDuration: 1.001
      })

      await this.app.removePlugin('test.jpy-ledger')

      await this.routeBuilder.quoteBySource('test.usd-ledger', {
        sourceAmount: '100',
        destinationAccount: 'test.jpy-ledger.bob',
        destinationHoldDuration: 1.001
      }).then((quote) => {
        throw new Error()
      }).catch((err) => {
        expect(err.name).to.equal('NoRouteFoundError')
        expect(err.message).to.match(/no route found. to=test.jpy-ledger.bob/)
      })
    })

    it('should depeer the removed ledger', async function () {
      assert.isOk(this.routeBroadcaster.peers.get('test.jpy-ledger'))
      await this.app.removePlugin('test.jpy-ledger')

      assert.isNotOk(this.routeBroadcaster.peers.get('test.jpy-ledger'))
    })
  })
})
