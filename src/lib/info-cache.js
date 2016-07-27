'use strict'

/**
 * Cache ledger meta-information.
 */
class InfoCache {
  constructor (core) {
    this.core = core
    this.cache = {}
  }

  * getInfoUncached (ledger) {
    return yield this.core.getPlugin(ledger).getInfo()
  }

  * get (ledger) {
    const cached = this.cache[ledger]
    if (cached) {
      return cached
    }

    const info = yield this.getInfoUncached(ledger)
    this.cache[ledger] = info
    return this.cache[ledger]
  }

  reset () {
    this.cache = {}
  }
}

module.exports = InfoCache
