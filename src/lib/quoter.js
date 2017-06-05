'use strict'

const BigNumber = require('bignumber.js')
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
   * @param {Ledgers} ledgers
   * @param {Object} request
   * @param {IlpAddress} request.sourceAccount
   * @param {IlpAddress} request.destinationAccount
   * @param {Integer} request.destinationHoldDuration
   * @returns {Object}
   */
  * quoteLiquidity (request) {
    const liquidityQuote = yield this._quoteLiquidity(request)
    if (!liquidityQuote) return null
    return Object.assign({}, liquidityQuote, {
      liquidityCurve: liquidityQuote.shiftedCurve.toBuffer(),
      expiresAt: new Date(liquidityQuote.expiresAt)
    })
  }

  _quoteLiquidity (request) {
    const hop = this.tables.localTables.findBestHopForSourceAmount(request.sourceAccount, request.destinationAccount, '0')
    if (!hop) return Promise.resolve(null)
    const connector = hop.bestHop
    const fullRoute = hop.bestRoute
    const headRoute = this.tables.localTables.getLocalRoute(fullRoute.sourceLedger, fullRoute.nextLedger)
    const baseQuote = {
      sourceLedger: fullRoute.sourceLedger,
      nextLedger: fullRoute.nextLedger,
      headCurve: headRoute.curve,
      // Used by CurveCache to generate shiftedCurve from liquidityCurve.
      shiftBy: this.tables.getScaleAdjustment(
        this.ledgers, fullRoute.sourceLedger, fullRoute.nextLedger)
    }
    const quoteExpiresAt = Date.now() + this.quoteExpiryDuration
    if (fullRoute.curve) {
      const liquidityQuote = Object.assign({
        nextConnector: fullRoute.isLocal ? null : connector,
        liquidityCurve: fullRoute.curve,
        appliesToPrefix: fullRoute.targetPrefix,
        sourceHoldDuration: request.destinationHoldDuration + fullRoute.minMessageWindow * 1000,
        expiresAt: quoteExpiresAt
      }, baseQuote)
      this.curveCache.insert(liquidityQuote)
      return Promise.resolve(liquidityQuote)
    }

    return ILQP.quoteByConnector({
      plugin: this.ledgers.getPlugin(fullRoute.nextLedger),
      connector,
      quoteQuery: {
        destinationAccount: request.destinationAccount,
        destinationHoldDuration: request.destinationHoldDuration
      }
    }).then((tailQuote) => {
      if (tailQuote.code) throw new IlpError(tailQuote)
      const tailCurve = new LiquidityCurve(tailQuote.liquidityCurve)
      const liquidityQuote = Object.assign({
        nextConnector: connector,
        liquidityCurve: headRoute.curve.join(tailCurve),
        appliesToPrefix: maxLength(fullRoute.targetPrefix, tailQuote.appliesToPrefix),
        sourceHoldDuration: headRoute.minMessageWindow * 1000 + tailQuote.sourceHoldDuration,
        expiresAt: Math.min(quoteExpiresAt, tailQuote.expiresAt.getTime())
      }, baseQuote)
      // Save the quoted curve.
      this.curveCache.insert(liquidityQuote)
      return liquidityQuote
    })
  }

  /**
   * @param {Ledgers} ledgers
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
    return yield this._quoteByAmount(request)
  }

  /**
   * @param {Ledgers} ledgers
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
    return yield this._quoteByAmount(request)
  }

  * _quoteByAmount (request) {
    // If we know a local route to the destinationAccount, use the local route.
    // Otherwise, ask a connector closer to the destination.
    const liquidityQuote = yield this._quoteLiquidity(request)
    if (!liquidityQuote) return null
    return Object.assign({
      sourceAmount: request.sourceAmount !== undefined ? request.sourceAmount
        // Use the shifted curve because the `amountReverse()` is rounded down,
        // and we don't want to lose money.
        : liquidityQuote.shiftedCurve.amountReverse(request.destinationAmount).toString(),
      destinationAmount: request.destinationAmount !== undefined ? request.destinationAmount
        : liquidityQuote.liquidityCurve.amountAt(
          new BigNumber(request.sourceAmount).toString()
        ).toString()
    }, liquidityQuote)
  }

  /**
   * @param {IlpAddress} sourceLedger
   * @param {IlpAddress} destination
   * @param {Amount} sourceAmount
   * @returns {Object}
   */
  * findBestPathForSourceAmount (sourceLedger, destination, sourceAmount) {
    const quote =
      this.curveCache.findBestQuoteForSourceAmount(
        sourceLedger, destination, sourceAmount) ||
      (yield this._quoteLiquidity({
        sourceAccount: sourceLedger,
        destinationAccount: destination,
        destinationHoldDuration: 10 // dummy value, only used if a remote quote is needed
      }))
    if (!quote) return
    return {
      isFinal: !quote.nextConnector,
      destinationLedger: quote.nextLedger,
      destinationCreditAccount: quote.nextConnector,
      destinationAmount: quote.headCurve.amountAt(sourceAmount).toString(),
      finalAmount: quote.liquidityCurve.amountAt(sourceAmount).toString()
    }
  }
}

function maxLength (prefix1, prefix2) {
  return prefix1.length > prefix2.length ? prefix1 : prefix2
}

module.exports = Quoter
