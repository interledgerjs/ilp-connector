'use strict'

const assert = require('assert')
const RoutingTables = require('../src/lib/routing-tables')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../src/common/log')

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

describe('RoutingTables', function () {
  logHelper(logger)

  beforeEach(function * () {
    appHelper.create(this)
  })

  describe('constructor', function () {
    it('sets isTrivialRate=true', function * () {
      const tables = new RoutingTables({
        backend: 'one-to-one',
        fxSpread: 0,
        slippage: 0
      })
      assert.equal(tables.isTrivialRate, true)
    })

    it('sets isTrivialRate=false when the backend is not one-to-one', function * () {
      const tables = new RoutingTables({
        backend: 'foo',
        fxSpread: 0,
        slippage: 0
      })
      assert.equal(tables.isTrivialRate, false)
    })

    it('sets isTrivialRate=false when the fxSpread is not zero', function * () {
      const tables = new RoutingTables({
        backend: 'foo',
        fxSpread: 0.01,
        slippage: 0
      })
      assert.equal(tables.isTrivialRate, false)
    })

    it('sets isTrivialRate=false when the slippage is not zero', function * () {
      const tables = new RoutingTables({
        backend: 'foo',
        fxSpread: 0,
        slippage: 0.01
      })
      assert.equal(tables.isTrivialRate, false)
    })
  })
})
