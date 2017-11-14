'use strict'

const ILQP = require('ilp').ILQP
const LiquidityCurve = require('ilp-routing').LiquidityCurve
const IlpPacket = require('ilp-packet')
const InvalidAmountSpecifiedError = require('../errors/invalid-amount-specified-error')
const IlpError = require('../errors/ilp-error')

class Quoter {
  /**
   * @param {Ledgers} ledgers
   * @param {Object} config
   * @param {Integer} config.quoteExpiry
   */
  constructor (ledgers, config) {
    this.ledgers = ledgers
    this.tables = ledgers.tables
    this.localTables = this.tables.localTables
    this.quoteExpiryDuration = config.quoteExpiry // milliseconds
  }

  /**
   * If that matching route has a local curve, it will be returned.
   * Otherwise, make a remote curve quote request.
   *
   * @param {Object} request
   * @param {IlpAddress} request.sourceAccount
   * @param {IlpAddress} request.destinationAccount
   * @param {Integer} request.destinationHoldDuration
   * @param {Boolean} [request._shiftCurve] default: true
   * @returns {Object}
   */
  async quoteLiquidity (request) {
    const liquidityQuote = await this._quoteLiquidity(
      Object.assign({_shiftCurve: true}, request))
    if (!liquidityQuote) return null
    return Object.assign({}, liquidityQuote, {
      liquidityCurve: liquidityQuote.liquidityCurve.toBuffer(),
      expiresAt: new Date(liquidityQuote.expiresAt)
    })
  }

  async _quoteLiquidity (request) {
    const hop = this.localTables.findBestHopForSourceAmount(
      request.sourceAccount, request.destinationAccount, '0')
    if (!hop) return Promise.resolve(null)
    const connector = hop.bestHop
    let fullRoute = hop.bestRoute
    if (isCurveExpired(fullRoute)) {
      const tailQuote = await ILQP.quoteByConnector({
        plugin: this.ledgers.getPlugin(fullRoute.nextLedger),
        connector,
        quoteQuery: {
          destinationAccount: request.destinationAccount,
          destinationHoldDuration: request.destinationHoldDuration
        }
      })
      if (tailQuote.responseType === IlpPacket.Type.TYPE_ILP_ERROR) {
        throw new IlpError(tailQuote)
      }
      const tailCurve = new LiquidityCurve(tailQuote.liquidityCurve)
      // The quote is more specific than the route.
      if (fullRoute.targetPrefix.length < tailQuote.appliesToPrefix.length) {
        // `fullRoute.nextLedger` is passed as the source ledger, since a tail
        // route is passed to `addRoute()`, not a full one.
        this.localTables.addRoute({
          source_ledger: fullRoute.nextLedger,
          destination_ledger: tailQuote.appliesToPrefix,
          source_account: connector,
          min_message_window: (tailQuote.sourceHoldDuration - request.destinationHoldDuration) / 1000,
          points: tailQuote.liquidityCurve
        })
        fullRoute = this.localTables.findBestHopForSourceAmount(
          request.sourceAccount, request.destinationAccount, '0').bestRoute
        fullRoute.expiresAt = tailQuote.expiresAt.getTime()
      // The quote is more general than the route, so update the route.
      } else {
        const headRoute = this.localTables.getLocalPairRoute(fullRoute.sourceLedger, fullRoute.nextLedger)
        fullRoute.curve = headRoute.curve.join(tailCurve)
        fullRoute.curveExpiresAt = tailQuote.expiresAt.getTime()
        fullRoute.minMessageWindow = (tailQuote.sourceHoldDuration - request.destinationHoldDuration) / 1000 + headRoute.minMessageWindow
      }
    }

    const shiftBy = request._shiftCurve
      ? this.tables.getScaleAdjustment(this.ledgers, fullRoute.sourceLedger, fullRoute.nextLedger)
      : 0
    const quoteExpiresAt = Date.now() + this.quoteExpiryDuration
    const routingTable = this.localTables.sources.resolve(request.sourceAccount)
    const appliesToPrefix = routingTable.getAppliesToPrefix(fullRoute.targetPrefix, request.destinationAccount)

    return {
      route: fullRoute,
      hop: fullRoute.isLocal ? null : connector,
      liquidityCurve: fullRoute.curve.shiftX(shiftBy),
      appliesToPrefix,
      sourceHoldDuration: request.destinationHoldDuration + fullRoute.minMessageWindow * 1000,
      expiresAt: Math.min(quoteExpiresAt, fullRoute.curveExpiresAt || Infinity)
    }
  }

  /**
   * @param {Object} request
   * @param {IlpAddress} request.sourceAccount
   * @param {IlpAddress} request.destinationAccount
   * @param {String} request.sourceAmount
   * @param {Integer} request.destinationHoldDuration
   * @returns {Object}
   */
  async quoteBySourceAmount (request) {
    if (request.sourceAmount === '0') {
      throw new InvalidAmountSpecifiedError('sourceAmount must be positive')
    }
    const liquidityQuote = await this._quoteLiquidity(request)
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
  async quoteByDestinationAmount (request) {
    if (request.destinationAmount === '0') {
      throw new InvalidAmountSpecifiedError('destinationAmount must be positive')
    }
    // Use the shifted curve because the `amountReverse()` is rounded down,
    // and we don't want to lose money.
    const liquidityQuote = await this._quoteLiquidity(Object.assign({_shiftCurve: true}, request))
    if (!liquidityQuote) return null
    const sourceAmount = liquidityQuote.liquidityCurve.amountReverse(request.destinationAmount).toString()
    if (sourceAmount === 'Infinity') return null
    return Object.assign({
      sourceAmount
    }, liquidityQuote)
  }

  /**
   * Note that this function, like most of the ilp-connector code, uses the terms
   * source, destination, and final, to refer to what we would normally call
   * incoming, outgoing, and destination.
   *
   * @param {IlpAddress} sourceLedger
   * @param {IlpAddress} destination
   * @param {Amount} finalAmount
   * @returns {Object}
   */
  async findBestPathForFinalAmount (sourceLedger, destination, finalAmount) {
    // This obtains a quote from incoming/"source" ledger to destination/"final" ledger:
    const quote = await this.quoteByDestinationAmount({
      sourceAccount: sourceLedger,
      destinationAccount: destination,
      destinationAmount: finalAmount,
      destinationHoldDuration: 10 // dummy value, only used if a remote quote is needed
    })
    if (!quote) return
    if (!quote.hop) {
      quote.hop = destination
    }

    // Now we isolate the head hop (incoming/"source" ledger to outgoing/"destination" ledger):
    const headRoute = this.localTables.getLocalPairRoute(sourceLedger, quote.route.nextLedger)
    const headCurve = headRoute.curve

    return {
      destinationLedger: quote.route.nextLedger,
      destinationCreditAccount: quote.hop,
      sourceAmount: quote.sourceAmount,
      destinationAmount: headCurve.amountAt(quote.sourceAmount).toString(),
      finalAmount: quote.liquidityCurve.amountAt(quote.sourceAmount).toString()
    }
  }
}

function isCurveExpired (route) {
  if (!route.curve) return true
  return route.curveExpiresAt && route.curveExpiresAt < Date.now()
}

module.exports = Quoter
