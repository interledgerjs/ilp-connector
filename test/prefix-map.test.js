'use strict'

const assert = require('assert')
const PrefixMap = require('../build/routing/prefix-map').default

describe('PrefixMap', function () {
  beforeEach(function () {
    this.map = new PrefixMap()
  })

  describe('keys', function () {
    it('returns a sorted list of keys', function () {
      assert.deepStrictEqual(this.map.keys(), [])
      this.map.insert('foo', { foo: 1 })
      assert.deepStrictEqual(this.map.keys(), ['foo'])
      this.map.insert('bar', { bar: 1 })
      assert.deepStrictEqual(this.map.keys(), ['foo', 'bar'])
    })
  })

  describe('size', function () {
    it('returns the number of items in the map', function () {
      assert.strictEqual(this.map.size(), 0)
      this.map.insert('foo', { foo: 1 })
      assert.strictEqual(this.map.size(), 1)
    })
  })

  describe('resolve', function () {
    it('returns an exact match', function () {
      this.map.insert('foo', { foo: 1 })
      this.map.insert('bar', { bar: 1 })
      assert.deepStrictEqual(this.map.resolve('foo'), { foo: 1 })
      assert.deepStrictEqual(this.map.resolve('bar'), { bar: 1 })
    })

    it('returns a prefix match', function () {
      this.map.insert('foo', { foo: 1 })
      assert.deepStrictEqual(this.map.resolve('foo.123'), { foo: 1 })
      assert.deepStrictEqual(this.map.resolve('foo.12'), { foo: 1 })
      assert.deepStrictEqual(this.map.resolve('foo.1'), { foo: 1 })
    })

    it('returns undefined for no match', function () {
      this.map.insert('foo', { foo: 1 })
      assert.strictEqual(this.map.resolve('a'), undefined)
      assert.strictEqual(this.map.resolve('z'), undefined)
      assert.strictEqual(this.map.resolve('foost'), undefined)
    })

    it('supports a catch-all key', function () {
      this.map.insert('test', { any: 1 })
      this.map.insert('test.foo', { foo: 1 })
      this.map.insert('test.bar', { bar: 1 })
      assert.deepStrictEqual(this.map.resolve('test.foo'), { foo: 1 })
      assert.deepStrictEqual(this.map.resolve('test.fo'), { any: 1 })
      assert.deepStrictEqual(this.map.resolve('test.f'), { any: 1 })
      assert.deepStrictEqual(this.map.resolve('test.bar'), { bar: 1 })
      assert.deepStrictEqual(this.map.resolve('test.baz'), { any: 1 })
      assert.deepStrictEqual(this.map.resolve('test'), { any: 1 })
    })

    it('returns the longest prefix that matches', function () {
      this.map.insert('test', { foo: 1 })
      this.map.insert('test.a.b.c', { foo: 2 })

      assert.deepStrictEqual(this.map.resolve('test.a.b.c.d'), { foo: 2 })
      assert.deepStrictEqual(this.map.resolve('test.a'), { foo: 1 })
    })
  })

  describe('get', function () {
    beforeEach(function () {
      this.map.insert('foo', { foo: 1 })
    })

    it('returns an exact match', function () {
      assert.deepStrictEqual(this.map.get('foo'), { foo: 1 })
    })

    it('returns undefined for prefix or non-matches', function () {
      assert.deepStrictEqual(this.map.get('foo123'), undefined)
      assert.deepStrictEqual(this.map.get('bar'), undefined)
      assert.deepStrictEqual(this.map.get(''), undefined)
    })
  })

  describe('each', function () {
    it('iterates items/keys', function () {
      this.map.insert('foo', { foo: 1 })
      this.map.insert('bar', { bar: 1 })
      const keys = []
      this.map.each(function (item, key) {
        assert.deepStrictEqual(item, { [key]: 1 })
        keys.push(key)
      })
      assert.deepStrictEqual(keys, ['foo', 'bar'])
    })
  })

  describe('insert', function () {
    it('overwrites a value on double-insert', function () {
      this.map.insert('foo', { foo: 1 })
      this.map.insert('foo', { foo: 2 })
      assert.deepStrictEqual(this.map.prefixes, ['foo'])
      assert.deepStrictEqual(this.map.items, { foo: { foo: 2 } })
    })

    it('sorts first by length', function () {
      this.map.insert('a.b.c', { foo: 1 })
      this.map.insert('z.', { foo: 2 })
      assert.deepStrictEqual(this.map.prefixes, ['a.b.c', 'z.'])
    })

    it('sorts secondarily by alphabetical order', function () {
      this.map.insert('a.b.c', { foo: 1 })
      this.map.insert('a.z.c', { foo: 3 })
      this.map.insert('a.f.c', { foo: 2 })
      assert.deepStrictEqual(this.map.prefixes, ['a.z.c', 'a.f.c', 'a.b.c'])
    })

    it('one more test for good measure cause this is really important', function () {
      this.map.insert('a.b.c', { foo: 1 })
      this.map.insert('z.', { foo: 3 })
      this.map.insert('a.f.c', { foo: 2 })
      this.map.insert('z.b.a', { foo: 3 })
      this.map.insert('z.b', { foo: 3 })
      this.map.insert('z.a', { foo: 3 })
      this.map.insert('a.z.c', { foo: 0 })

      assert.deepStrictEqual(this.map.prefixes, ['z.b.a', 'a.z.c', 'a.f.c', 'a.b.c', 'z.b', 'z.a', 'z.'])
    })

    it('works with empty prefixes', function () {
      this.map.insert('a.b.c', { foo: 1 })
      this.map.insert('', { foo: 2 })
      this.map.insert('z.', { foo: 3 })

      assert.deepStrictEqual(this.map.prefixes, ['a.b.c', 'z.', ''])
    })
  })

  describe('delete', function () {
    it('removes a prefix and the corresponding item', function () {
      this.map.insert('foo', { foo: 1 })
      this.map.insert('bar', { bar: 1 })
      this.map.delete('bar')
      assert.deepStrictEqual(this.map.prefixes, ['foo'])
      assert.deepStrictEqual(this.map.items, { foo: { foo: 1 } })
      this.map.delete('foobar')
      assert.deepStrictEqual(this.map.prefixes, ['foo'])
      assert.deepStrictEqual(this.map.items, { foo: { foo: 1 } })
      this.map.delete('foo')
      assert.deepStrictEqual(this.map.prefixes, [])
      assert.deepStrictEqual(this.map.items, {})
    })
  })
})
