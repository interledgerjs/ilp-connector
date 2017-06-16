'use strict'

const ILQP = require('ilp').ILQP
const LiquidityCurve = require('ilp-routing').LiquidityCurve
const InvalidAmountSpecifiedError = require('../errors/invalid-amount-specified-error')
const IlpError = require('../errors/ilp-error')

class Quoter {
  /**
   * @param {Ledgers} ledgers
   * @param {CurveCache} curveCache
   * @param {Object} config
   * @param {Integer} config.quoteExpiry
   */
  constructor (ledgers, curveCache, config) {
    this.ledgers = ledgers
    this.tables = ledgers.tables
    this.curveCache = curveCache
    this.quoteExpiryDuration = config.quoteExpiry // milliseconds
  }

  /**
   * @param {Object} request
   * @param {IlpAddress} request.sourceAccount
   * @param {IlpAddress} request.destinationAccount
   * @param {Integer} request.destinationHoldDuration
   * @param {Boolean} [request._checkCache] default: false
   * @param {Boolean} [request._shiftCurve] default: true
   * @returns {Object}
   */
  * quoteLiquidity (request) {
    const liquidityQuote = yield this._quoteLiquidity(
      Object.assign({_shiftCurve: true}, request))
    if (!liquidityQuote) return null
    return Object.assign({}, liquidityQuote, {
      liquidityCurve: liquidityQuote.liquidityCurve.toBuffer(),
      expiresAt: new Date(liquidityQuote.expiresAt)
    })
  }

  _quoteLiquidity (request) {
    const hop = this.tables.localTables.findBestHopForSourceAmount(request.sourceAccount, request.destinationAccount, '0')
    if (!hop) return Promise.resolve(null)
    const connector = hop.bestHop
    const fullRoute = hop.bestRoute
    const shiftBy = request._shiftCurve
      ? this.tables.getScaleAdjustment(this.ledgers, fullRoute.sourceLedger, fullRoute.nextLedger)
      : 0
    const quoteExpiresAt = Date.now() + this.quoteExpiryDuration
    if (fullRoute.curve) {
      return Promise.resolve({
        route: fullRoute,
        hop: fullRoute.isLocal ? null : connector,
        liquidityCurve: fullRoute.curve.shiftX(shiftBy),
        appliesToPrefix: fullRoute.targetPrefix,
        sourceHoldDuration: request.destinationHoldDuration + fullRoute.minMessageWindow * 1000,
        expiresAt: quoteExpiresAt
      })
    }

    const headRoute = this.tables.localTables.getLocalRoute(fullRoute.sourceLedger, fullRoute.nextLedger)
    return this._getRemoteQuote(fullRoute.nextLedger, connector, request).then((tailQuote) => {
      return {
        route: fullRoute,
        hop: connector,
        liquidityCurve: headRoute.curve.join(tailQuote.liquidityCurve).shiftX(shiftBy),
        appliesToPrefix: maxLength(fullRoute.targetPrefix, tailQuote.appliesToPrefix),
        sourceHoldDuration: headRoute.minMessageWindow * 1000 + tailQuote.sourceHoldDuration,
        expiresAt: Math.min(quoteExpiresAt, tailQuote.expiresAt)
      }
    })
  }

  _getRemoteQuote (nextLedger, nextConnector, request) {
    if (request._checkCache) {
      const cachedQuote = this.curveCache.findBestQuoteForSourceAmount(request.sourceAmount || '0')
      if (cachedQuote) return cachedQuote
    }
    return ILQP.quoteByConnector({
      plugin: this.ledgers.getPlugin(nextLedger),
      connector: nextConnector,
      quoteQuery: {
        destinationAccount: request.destinationAccount,
        destinationHoldDuration: request.destinationHoldDuration
      }
    }).then((tailQuote) => {
      if (tailQuote.code) throw new IlpError(tailQuote)
      const tailCurve = new LiquidityCurve(tailQuote.liquidityCurve)
      // Save the quoted curve.
      const quote = Object.assign({}, tailQuote, {
        nextLedger,
        nextConnector,
        liquidityCurve: tailCurve,
        expiresAt: tailQuote.expiresAt.getTime()
      })
      this.curveCache.insert(quote)
      return quote
    })
  }

  /**
   * @param {Object} request
   * @param {IlpAddress} request.sourceAccount
   * @param {IlpAddress} request.destinationAccount
   * @param {String} request.sourceAmount
   * @param {Integer} request.destinationHoldDuration
   * @returns {Object}
   */
  * quoteBySourceAmount (request) {
    if (request.sourceAmount === '0') {
      throw new InvalidAmountSpecifiedError('sourceAmount must be positive')
    }
    const liquidityQuote = yield this._quoteLiquidity(request)
    if (!liquidityQuote) return null
    return Object.assign({
      destinationAmount: liquidityQuote.liquidityCurve.amountAt(request.sourceAmount).toString()
    }, liquidityQuote)
  }

  /**
   * @param {Object} request
   * @param {IlpAddress} request.sourceAccount
   * @param {IlpAddress} request.destinationAccount
   * @param {String} request.destinationAmount
   * @param {Integer} request.destinationHoldDuration
   * @returns {Object}
   */
  * quoteByDestinationAmount (request) {
    if (request.destinationAmount === '0') {
      throw new InvalidAmountSpecifiedError('destinationAmount must be positive')
    }
    // Use the shifted curve because the `amountReverse()` is rounded down,
    // and we don't want to lose money.
    const liquidityQuote = yield this._quoteLiquidity(Object.assign({_shiftCurve: true}, request))
    if (!liquidityQuote) return null
    return Object.assign({
      sourceAmount: liquidityQuote.liquidityCurve.amountReverse(request.destinationAmount).toString()
    }, liquidityQuote)
  }

  /**
   * @param {IlpAddress} sourceLedger
   * @param {IlpAddress} destination
   * @param {Amount} sourceAmount
   * @returns {Object}
   */
  * findBestPathForSourceAmount (sourceLedger, destination, sourceAmount) {
    const quote = yield this.quoteBySourceAmount({
      sourceAccount: sourceLedger,
      destinationAccount: destination,
      sourceAmount: sourceAmount,
      destinationHoldDuration: 10 // dummy value, only used if a remote quote is needed
    })
    if (!quote) return
    const headRoute = this.tables.localTables.getLocalRoute(sourceLedger, quote.route.nextLedger)
    const headCurve = headRoute.curve
    return {
      isFinal: !quote.hop,
      destinationLedger: quote.route.nextLedger,
      destinationCreditAccount: quote.hop,
      destinationAmount: headCurve.amountAt(sourceAmount).toString(),
      finalAmount: quote.liquidityCurve.amountAt(sourceAmount).toString()
    }
  }
}

function maxLength (prefix1, prefix2) {
  return prefix1.length > prefix2.length ? prefix1 : prefix2
}

module.exports = Quoter
