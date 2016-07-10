'use strict'
const newSqliteStore = require('../src/lib/sqliteStore')
const assert = require('chai').assert

describe('SqliteStore', function () {
  let obj = null
  it('should create an object', () => {
    obj = newSqliteStore()
    assert.isObject(obj)
  })

  it('should support deletion', function (done) {
    obj.put('k', 'v').then(() => {
      return obj.del('k')
    }).then(() => {
      return obj.get('k')
    }).then((value) => {
      assert(value === undefined)
      done()
    })
  })

  it('should support adding elements', function (done) {
    obj.put('k', 'v').then(() => {
      return obj.get('k')
    }).then((value) => {
      assert(value === 'v')
      done()
    }).catch((err) => { console.error(err) })
  })
})
