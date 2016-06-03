'use strict'

const FiveBellsLedger = require('../ledgers/five-bells-ledger')

/**
 * Cache ledger meta-information.
 */
class InfoCache {
  constructor (ledgers) {
    this.ledgers = ledgers
    this.cache = {}
  }

  * getInfoUncached (ledger) {
    let plugin = this.ledgers.getLedger(ledger)
    if (!plugin) {
      // Default to Five Bells Ledger
      // TODO: This hack is necessary to fetch the precision information for
      // non-adjacent ledgers. How can we handle this case properly?
      plugin = new FiveBellsLedger({
        ledger_id: ledger
      })
    }
    return yield plugin.getInfo()
  }

  * get (ledger) {
    const cached = this.cache[ledger]
    if (cached) {
      return cached
    }

    const precision = yield this.getInfoUncached(ledger)
    this.cache[ledger] = precision
    return this.cache[ledger]
  }

  reset () {
    this.cache = {}
  }
}

module.exports = InfoCache
