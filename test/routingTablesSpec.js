'use strict'

const assert = require('assert')
const RoutingTables = require('../src/lib/routing-tables')
const nock = require('nock')
const appHelper = require('./helpers/app')

const ledgerA = 'cad-ledger.'
const ledgerB = 'usd-ledger.'
const ledgerC = 'eur-ledger.'
const baseURI = 'http://connector.example'

describe('RoutingTables', function () {
  beforeEach(function * () {
    appHelper.create(this)

    this.infoCache = {
      get: function * (ledger) {
        return {precision: 10, scale: 2}
      }
    }

    this.tables = new RoutingTables({
      baseURI: baseURI,
      fxSpread: 0.002,
      slippage: 0.001
    })
    yield this.tables.addLocalRoutes(this.infoCache, [{
      source_ledger: ledgerA,
      destination_ledger: ledgerB,
      connector: baseURI,
      min_message_window: 1,
      source_account: ledgerA + 'mark',
      destination_account: ledgerB + 'mark',
      points: [ [0, 0], [200, 100] ],
      additional_info: {}
    }, {
      source_ledger: ledgerB,
      destination_ledger: ledgerA,
      connector: baseURI,
      min_message_window: 1,
      source_account: ledgerB + 'mark',
      destination_account: ledgerA + 'mark',
      points: [ [0, 0], [100, 200] ],
      additional_info: {}
    }])

    this.tables.addRoute({
      source_ledger: ledgerB,
      destination_ledger: ledgerC,
      connector: 'http://other-connector2.example',
      min_message_window: 1,
      points: [ [0, 0], [50, 60] ],
      additional_info: {}
    })
  })

  afterEach(function * () { assert(nock.isDone()) })

  describe('constructor', function () {
    it('sets isTrivialRate=true', function * () {
      const tables = new RoutingTables({
        baseURI: baseURI,
        backend: 'one-to-one',
        fxSpread: 0,
        slippage: 0
      })
      assert.equal(tables.isTrivialRate, true)
    })

    it('sets isTrivialRate=false when the backend is not one-to-one', function * () {
      const tables = new RoutingTables({
        baseURI: baseURI,
        backend: 'foo',
        fxSpread: 0,
        slippage: 0
      })
      assert.equal(tables.isTrivialRate, false)
    })

    it('sets isTrivialRate=false when the fxSpread is not zero', function * () {
      const tables = new RoutingTables({
        baseURI: baseURI,
        backend: 'foo',
        fxSpread: 0.01,
        slippage: 0
      })
      assert.equal(tables.isTrivialRate, false)
    })

    it('sets isTrivialRate=false when the slippage is not zero', function * () {
      const tables = new RoutingTables({
        baseURI: baseURI,
        backend: 'foo',
        fxSpread: 0,
        slippage: 0.01
      })
      assert.equal(tables.isTrivialRate, false)
    })
  })
})
