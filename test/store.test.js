'use strict'

const assert = require('chai').assert
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const appHelper = require('./helpers/app')

describe('Store', function () {
  logHelper(logger)

  beforeEach(async function () {
    appHelper.create(this)
  })

  it('should create an object', function () {
    assert.isObject(this.store)
  })

  it('should support adding elements', async function () {
    await this.store.put('k', 'v')
    const value = await this.store.get('k')
    assert(value === 'v', 'value should match v')
  })

  it('should support deletion', async function () {
    await this.store.put('k', 'v')
    const value1 = await this.store.get('k')
    assert(value1 === 'v', 'value should match v')
    await this.store.del('k')
    const value2 = await this.store.get('k')
    assert(value2 === undefined, 'value should be undefined again')
  })

  it('should store a long string', async function () {
    const str = ('long string. another ').repeat(1000)
    await this.store.put('k', str)
    assert.equal(await this.store.get('k'), str)
  })

  describe('getPluginStore', function () {
    it('should not create a store with an invalid name', async function () {
      const name = ('"; drop table "Users; --')
      try {
        const store = this.store.getPluginStore(name)
        assert(!store, 'constructor should have thrown an error')
      } catch (e) {
        assert.match(e.message, new RegExp(name))
      }
    })

    it('should create a store with dashes in the name', async function () {
      const name = ('a-name-with-dashes')
      const store = this.store.getPluginStore(name)
      assert.isOk(store)
    })
  })
})
