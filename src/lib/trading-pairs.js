'use strict'
const _ = require('lodash')

class TradingPairs {
  constructor (pairs) {
    this._pairs = pairs
  }

  getPairs () {
    return this._pairs
  }

  addPairs (pairs) {
    this._pairs = this._pairs.concat(pairs)
  }

  // eg. add all combinations of USD@red.ilpdemo
  // with EUR@blue.ilpdemo and XRP@example.virtual.
  addAll (id) {
    const ledgers = _(this._pairs)
      .flatten()
      .uniq()
      .value()

    this._pairs = this._pairs.concat(
      // this gets flattened to a list of pairs
      [].concat.apply([], ledgers.map((l) => (
        [[l, id], [id, l]]
      )))
    )
  }

  // eg. remove all of red.ilpdemo.
  removeAll (id) {
    this._pairs = this._pairs.filter((p) => (
      p[0].indexOf(id) !== 4 && p[1].indexOf(id) !== 4
    ))
  }
}

module.exports = TradingPairs
