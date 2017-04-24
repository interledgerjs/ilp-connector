'use strict'
const PluginStore = require('../src/lib/pluginStore')
const assert = require('chai').assert

describe('PluginStore', function () {
  beforeEach(function * () {
    this.obj = new PluginStore('sqlite://:memory:', 'test')
  })

  it('should create an object', function () {
    assert.isObject(this.obj)
  })

  it('should support deletion', function (done) {
    this.obj.put('k', 'v').then(() => {
      return this.obj.del('k')
    }).then(() => {
      return this.obj.get('k')
    }).then((value) => {
      assert(value === undefined)
      done()
    })
  })

  it('should support adding elements', function (done) {
    this.obj.put('k', 'v').then(() => {
      return this.obj.get('k')
    }).then((value) => {
      assert(value === 'v')
      done()
    }).catch((err) => { console.error(err) })
  })

  it('should store a long string', function * () {
    const str = ('long string. another ').repeat(1000)
    yield this.obj.put('k', str)
    assert.equal(yield this.obj.get('k'), str)
  })

  it('should not create a store with an invalid name', function * () {
    const name = ('"; drop table "Users; --')
    try {
      const store = new PluginStore('sqlite://:memory:', name)
      assert(!store, 'constructor should have thrown an error')
    } catch (e) {
      assert.match(e.message, new RegExp(name))
    }
  })

  it('should create a store with dashes in the name', function * () {
    const name = ('a-name-with-dashes')
    const store = new PluginStore('sqlite://:memory:', name)
    assert.isOk(store)
  })
})
