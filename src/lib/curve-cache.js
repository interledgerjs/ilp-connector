'use strict'
const BigNumber = require('bignumber.js')
const PrefixMap = require('ilp-routing').PrefixMap

/**
 * Cache remote liquidity curve quotes so that they can be referenced during payment.
 */
class CurveCache {
  /**
   * @param {Object} params
   * @param {Integer} params.quoteCleanupInterval milliseconds
   */
  constructor (params) {
    this.sources = {} // { sourceLedger ⇒ { appliesToPrefix ⇒ [liquidityQuote] } }
    this.quoteCleanupInterval = params.quoteCleanupInterval
  }

  start () {
    setInterval(this.removeExpiredQuotes.bind(this), this.quoteCleanupInterval)
  }

  removeExpiredQuotes () {
    for (const sourceLedger in this.sources) {
      const destinations = this.sources[sourceLedger]
      for (const appliesToPrefix of destinations.keys()) {
        const quotes = destinations.get(appliesToPrefix)
        destinations.insert(appliesToPrefix, quotes.filter((quote) => !isExpired(quote)))
      }
    }
  }

  /**
   * @param {Object} liquidityQuote
   */
  insert (liquidityQuote) {
    // The shifted curve is used during quote-by-destination to counter the
    // computed source amount being rounded down.
    this._getQuotes(
      liquidityQuote.sourceLedger,
      liquidityQuote.appliesToPrefix
    ).push(liquidityQuote)
  }

  /**
   * @param {IlpAddress} sourceLedger
   * @param {IlpAddress} destination
   * @param {Amount} sourceAmount
   * @returns {Object} liquidityQuote
   */
  findBestQuoteForSourceAmount (sourceLedger, destination, sourceAmount) {
    const quotes = this._getQuotes(sourceLedger, destination)
    let bestQuote = null
    let bestValue = null
    for (const quote of quotes) {
      if (isExpired(quote)) continue
      const destinationAmount = new BigNumber(quote.liquidityCurve.amountAt(sourceAmount))
      if (!bestValue || bestValue.lt(destinationAmount)) {
        bestValue = destinationAmount
        bestQuote = quote
      }
    }
    return bestQuote
  }

  _getQuotes (sourceLedger, destination) {
    const destinations = this.sources[sourceLedger] ||
      (this.sources[sourceLedger] = new PrefixMap())
    let quotes = destinations.resolve(destination)
    if (!quotes) {
      quotes = []
      destinations.insert(destination, quotes)
    }
    return quotes
  }
}

function isExpired (quote) {
  return quote.expiresAt < Date.now()
}

module.exports = CurveCache
