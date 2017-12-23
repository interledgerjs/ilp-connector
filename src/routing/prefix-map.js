'use strict'

const findIndex = require('lodash/findIndex')

/**
 * A key-value map where the members' keys represent prefixes.
 *
 * Example:
 *   const map = new PrefixMap()
 *   map.insert("foo", 1)
 *   map.insert("bar", 2)
 *   map.get("foo")     // ⇒ 1
 *   map.get("foo.bar") // ⇒ 1 ("foo" is the longest known prefix of "foo.bar")
 *   map.get("bar")     // ⇒ 2
 *   map.get("bar.foo") // ⇒ 2 ("bar" is the longest known prefix of "bar.foo")
 *   map.get("random")  // ⇒ null
 */
class PrefixMap {
  constructor () {
    this.prefixes = []
    this.items = {}
  }

  keys () { return this.prefixes }

  size () { return this.prefixes.length }

  resolve (key) {
    // Exact match
    if (this.items[key]) return this.items[key] // redundant; optimization?
    // prefix match (the list is in descending length order, and secondarily, reverse-alphabetically)
    const index = findIndex(this.prefixes, (e) => key.startsWith(e))
    if (index === -1) return null
    const prefix = this.prefixes[index]
    return this.items[prefix]
  }

  get (prefix) { return this.items[prefix] || null }

  /**
   * @param {function(item, key)} fn
   */
  each (fn) {
    for (const prefix of this.prefixes) {
      fn(this.items[prefix], prefix)
    }
  }

  /**
   * Insert the prefix while keeping the prefixes sorted first in length order
   * and if two prefixes are the same length, sort them in reverse alphabetical order
   */
  insert (prefix, item) {
    if (!this.items[prefix]) {
      const index = findIndex(this.prefixes, (e) => {
        if (prefix.length === e.length) {
          return prefix > e
        }
        return prefix.length > e.length
      })

      if (index === -1) {
        this.prefixes.push(prefix)
      } else {
        this.prefixes.splice(index, 0, prefix)
      }
    }
    this.items[prefix] = item
    return item
  }

  delete (prefix) {
    const index = this.prefixes.indexOf(prefix)
    if (this.prefixes[index] === prefix) this.prefixes.splice(index, 1)
    delete this.items[prefix]
  }

  toJSON () {
    return this.items
  }
}

module.exports = PrefixMap
