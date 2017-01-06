'use strict'

const _ = require('lodash')

class TradingPairs {
  constructor () {
    this._sources = new Map()
    this._pairsCache = null
  }

  toArray () {
    // Turning the pairs into an array could be expensive, so we cache it
    if (!this._pairsCache) {
      this._pairsCache = _.flatten(Array.from(this._sources.keys()).map(from => {
        return Array.from(this._sources.get(from)).map(to => [from, to])
      }))
    }
    return this._pairsCache
  }

  addPairs (pairs) {
    for (let pair of pairs) {
      this.add(pair[0], pair[1])
    }
  }

  // eg. add all combinations of USD@red.ilpdemo
  // with EUR@blue.ilpdemo and XRP@example.virtual.
  add (from, to) {
    let source = this._sources.get(from)
    if (!source) {
      source = new Set()
      this._sources.set(from, source)
    }
    source.add(to)

    // Anytime we change _sources, we need to invalidate the cache
    this._pairsCache = null
  }

  // eg. remove all of USD@red.ilpdemo.
  removeAll (id) {
    this._sources.delete(id)
    for (let destinationSet of this._sources.values()) {
      destinationSet.delete(id)
    }

    // Anytime we change _sources, we need to invalidate the cache
    this._pairsCache = null
  }

  empty () {
    this._sources = new Map()
    this._pairsCache = null
  }
}

module.exports = TradingPairs
