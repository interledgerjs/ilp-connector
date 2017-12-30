'use strict'

const BigNumber = require('bignumber.js')
const NoRouteFoundError = require('../errors/no-route-found-error')
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')
const UnacceptableAmountError = require('../errors/unacceptable-amount-error')
const LedgerNotConnectedError = require('../errors/ledger-not-connected-error')
const InvalidAmountSpecifiedError = require('../errors/invalid-amount-specified-error')
const InvalidPacketError = require('../errors/invalid-packet-error')
const UnreachableError = require('../errors/unreachable-error')
const InsufficientTimeoutError = require('../errors/insufficient-timeout-error')
const Accounts = require('./accounts')
const RoutingTable = require('./routing-table')
const RateBackend = require('./rate-backend')
const Quoter = require('./quoter')
const Config = require('./config')
const LiquidityCurve = require('../routing/liquidity-curve')
const log = require('../common/log').create('route-builder')
const { getShortestUnambiguousPrefix } = require('../lib/utils')

const PROBE_AMOUNT = new BigNumber(10).pow(14) // stays within 15 max digits for BigNumber from Number

function rateToCurve (rate) {
  rate = new BigNumber(rate)

  // Make sure that neither amount exceeds 15 significant digits.
  if (rate.gt(1)) {
    return new LiquidityCurve([ [0, 0], [ PROBE_AMOUNT / rate, PROBE_AMOUNT ] ])
  } else {
    return new LiquidityCurve([ [0, 0], [ PROBE_AMOUNT, PROBE_AMOUNT * rate ] ])
  }
}

class RouteBuilder {
  constructor (deps) {
    this.accounts = deps(Accounts)
    this.routingTable = deps(RoutingTable)
    this.backend = deps(RateBackend)
    this.quoter = deps(Quoter)
    this.config = deps(Config)

    this.minMessageWindow = this.config.minMessageWindow * 1000 // millseconds
    this.maxHoldTime = this.config.maxHoldTime * 1000 // millseconds
    this.quoteExpiryDuration = this.config.quoteExpiry // milliseconds
    this.slippage = this.config.slippage
    this.secret = this.config.secret
    this.reflectPayments = this.config.reflectPayments
  }

  getNextHop (sourceAccount, destinationAccount) {
    const nextHop = this.routingTable.resolve(destinationAccount)

    if (!nextHop) {
      log.info('no route found for quote. destinationAccount=' + destinationAccount)
      throw new NoRouteFoundError('no route found. to=' + destinationAccount)
    }

    if (!this.reflectPayments && sourceAccount === nextHop) {
      log.info('refusing to route payments back to sender. sourceAccount=%s destinationAccount=%s', sourceAccount, destinationAccount)
      throw new NoRouteFoundError('refusing to route payments back to sender. sourceAccount=' + sourceAccount + ' destinationAccount=' + destinationAccount)
    }

    return nextHop
  }

  async quoteLocal (sourceAccount, destinationAccount) {
    if (!this.accounts.getCurrency(sourceAccount)) {
      log.info('source account is unavailable. sourceAccount=' + sourceAccount)
      throw new NoRouteFoundError('no route from source. sourceAccount=' + sourceAccount)
    }

    const nextHop = this.getNextHop(sourceAccount, destinationAccount)

    if (!this.accounts.getCurrency(nextHop)) {
      log.info('next hop is unavailable. nextHop=' + nextHop)
      throw new NoRouteFoundError('no route to next hop. nextHop=' + nextHop)
    }

    log.debug('determined next hop. nextHop=' + nextHop)

    const rate = await this.backend.getRate(sourceAccount, nextHop)

    log.debug('determined local rate. rate=' + rate)

    return { nextHop, rate }
  }

  /**
   * @param {Object} params
   * @param {String} params.sourceAccount
   * @param {String} params.destinationAccount
   * @param {Number} params.destinationHoldDuration
   * @returns {QuoteLiquidityResponse}
   */
  async quoteLiquidity (params) {
    log.info('creating liquidity quote. sourceAccount=%s destinationAccount=%s',
      params.sourceAccount, params.destinationAccount)

    const { nextHop, rate } = await this.quoteLocal(params.sourceAccount, params.destinationAccount)
    const localQuoteExpiry = Date.now() + this.quoteExpiryDuration

    const localCurve = rateToCurve(rate)

    let liquidityCurve
    let appliesToPrefix
    let sourceHoldDuration
    let expiresAt
    if (params.destinationAccount.startsWith(nextHop)) {
      log.debug('local destination.')
      liquidityCurve = localCurve
      appliesToPrefix = nextHop
      sourceHoldDuration = params.destinationHoldDuration + this.minMessageWindow
      expiresAt = localQuoteExpiry
    } else {
      const quote = await this.quoter.quoteLiquidity(nextHop, params.destinationAccount)
      if (!quote) {
        log.info('no quote found. params=%j', params)
        throw new NoRouteFoundError('no quote found. to=' + params.destinationAccount)
      }
      log.debug('remote destination. quote=%j', quote)

      liquidityCurve = localCurve.join(quote.curve)
      appliesToPrefix = quote.prefix
      sourceHoldDuration = params.destinationHoldDuration + quote.minMessageWindow + this.minMessageWindow
      expiresAt = Math.min(quote.expiry, localQuoteExpiry)
    }

    this._verifyPluginIsConnected(nextHop)
    this._validateHoldDurations(sourceHoldDuration, params.destinationHoldDuration)

    const shiftBy = this._getScaleAdjustment(params.sourceAccount, nextHop)

    return {
      // Shifting the curve right by one unit effectively makes it so the client
      // always sends enough money even despite rounding errors.
      liquidityCurve: liquidityCurve.shiftX(shiftBy).toBuffer(),
      // We need to say which prefix this curve applies to. But for that
      // prefix, the curve must ALWAYS apply because people may cache it.
      // So we need the shortest prefix of the destination for which this
      // cached curve will ALWAYS apply.
      appliesToPrefix: getShortestUnambiguousPrefix(this.routingTable, params.destinationAccount, appliesToPrefix),
      sourceHoldDuration,
      expiresAt: new Date(expiresAt)
    }
  }

  _getScaleAdjustment (sourceAccount, destinationAccount) {
    const sourceScale = this.accounts.getInfo(sourceAccount).currencyScale
    const destinationScale = this.accounts.getInfo(destinationAccount).currencyScale
    if (sourceScale === destinationScale && this.isTrivialRate) return 0
    return 1
  }

  /**
   * @param {Object} params
   * @param {String} params.sourceAccount
   * @param {String} params.destinationAccount
   * @param {Number} params.destinationHoldDuration
   * @param {String} params.sourceAmount
   * @returns {QuoteBySourceResponse}
   */
  async quoteBySource (params) {
    log.info('creating quote by source amount. sourceAccount=%s destinationAccount=%s sourceAmount=%s',
      params.sourceAccount, params.destinationAccount, params.sourceAmount)

    if (params.sourceAmount === '0') {
      throw new InvalidAmountSpecifiedError('sourceAmount must be positive')
    }

    const { nextHop, rate } = await this.quoteLocal(params.sourceAccount, params.destinationAccount)

    const nextAmount = new BigNumber(params.sourceAmount).times(rate).floor().toString()
    let destinationAmount
    let sourceHoldDuration
    if (params.destinationAccount.startsWith(nextHop)) {
      log.debug('local destination. destinationAmount=' + nextAmount)
      destinationAmount = nextAmount
      sourceHoldDuration = params.destinationHoldDuration + this.minMessageWindow
    } else {
      const quote = await this.quoter.quoteLiquidity(nextHop, params.destinationAccount)
      if (!quote) {
        log.info('no quote found. params=%j', params)
        throw new NoRouteFoundError('no quote found. to=' + params.destinationAccount)
      }
      log.debug('remote destination. quote=%j', quote)

      destinationAmount = quote.curve.amountAt(params.sourceAmount).times(rate).floor().toString()
      sourceHoldDuration = params.destinationHoldDuration + quote.minMessageWindow + this.minMessageWindow
    }

    if (destinationAmount === '0') {
      throw new UnacceptableAmountError('quoted destination is lower than minimum amount allowed.')
    }

    this._verifyPluginIsConnected(params.sourceAccount)
    this._verifyPluginIsConnected(nextHop)
    this._validateHoldDurations(sourceHoldDuration, params.destinationHoldDuration)

    return {
      destinationAmount,
      sourceHoldDuration
    }
  }

  /**
   * @param {Object} params
   * @param {String} params.sourceAccount
   * @param {String} params.destinationAccount
   * @param {Number} params.destinationHoldDuration
   * @param {String} params.destinationAmount
   * @returns {QuoteByDestinationResponse}
   */
  async quoteByDestination (params) {
    log.info('creating quote by destination amount. sourceAccount=%s destinationAccount=%s destinationAmount=%s',
      params.sourceAccount, params.destinationAccount, params.destinationAmount)

    if (params.destinationAmount === '0') {
      throw new InvalidAmountSpecifiedError('destinationAmount must be positive')
    }

    const { nextHop, rate } = await this.quoteLocal(params.sourceAccount, params.destinationAccount)

    let nextHopAmount
    let nextHopHoldDuration
    if (params.destinationAccount.startsWith(nextHop)) {
      log.debug('local destination.')
      nextHopAmount = params.destinationAmount
      nextHopHoldDuration = params.destinationHoldDuration
    } else {
      const quote = await this.quoter.quoteLiquidity(nextHop, params.destinationAccount)
      if (!quote) {
        log.info('no quote found. params=%j', params)
        throw new NoRouteFoundError('no quote found. to=' + params.destinationAccount)
      }
      log.debug('remote destination. quote=%j', quote)

      nextHopAmount = quote.curve.amountReverse(params.destinationAmount).toString()
    }

    const sourceAmount = new BigNumber(nextHopAmount).div(rate).ceil().toString()
    const sourceHoldDuration = nextHopHoldDuration + this.minMessageWindow
    if (sourceAmount === '0') {
      throw new UnacceptableAmountError('Quoted source is lower than minimum amount allowed')
    }
    this._verifyPluginIsConnected(params.sourceAccount)
    this._verifyPluginIsConnected(nextHop)
    this._validateHoldDurations(sourceHoldDuration, params.destinationHoldDuration)
    return {
      sourceAmount,
      sourceHoldDuration
    }
  }

  /**
   * @typedef {Object} NextHopPacketInfo
   * @property {string} nextHop Address of the next peer to forward the packet to
   * @property {Buffer} nextHopPacket Outgoing packet
   */

  /**
   * Get next ILP prepare packet.
   *
   * Given a previous ILP prepare packet, returns the next ILP prepare packet in
   * the chain.
   *
   * @param {string} sourceAccount ILP address of our peer who sent us the packet
   * @param {IlpPrepare} sourcePacket (Parsed packet that we received
   * @returns {NextHopPacketInfo} Account and packet for next hop
   */
  async getNextHopPacket (sourceAccount, sourcePacket) {
    const {
      amount,
      executionCondition,
      expiresAt,
      destination,
      data
    } = sourcePacket

    log.info(
      'constructing next hop packet. sourceAccount=%s sourceAmount=%s destination=%s',
      sourceAccount, amount, destination
    )

    if (destination.length < 1) {
      throw new InvalidPacketError('missing destination.')
    }

    const nextHop = this.routingTable.resolve(destination)

    if (!nextHop) {
      log.info('could not find route for transfer. sourceAccount=%s sourceAmount=%s destinationAccount=%s', sourceAccount, amount, destination)
      throw new UnreachableError('no route found. source=' + sourceAccount + ' destination=' + destination)
    }

    log.debug('determined next hop. nextHop=%s', nextHop)

    const rate = await this.backend.getRate(sourceAccount, nextHop)

    log.debug('determined local rate. rate=%s', rate)

    this._verifyPluginIsConnected(nextHop)

    const nextAmount = new BigNumber(amount).times(rate).floor()

    return {
      nextHop,
      nextHopPacket: {
        amount: nextAmount.toString(),
        expiresAt: this._getDestinationExpiry(expiresAt),
        executionCondition,
        destination,
        data
      }
    }
  }

  // TODO: include the expiry duration in the quote logic
  _validateHoldDurations (sourceHoldDuration, destinationHoldDuration) {
    // Check destination_expiry_duration
    if (destinationHoldDuration > this.maxHoldTime) {
      throw new UnacceptableExpiryError('destination expiry duration ' +
        'is too long. destinationHoldDuration=' + destinationHoldDuration +
        ' maxHoldTime=' + this.maxHoldTime)
    }

    // Check difference between destination_expiry_duration and source_expiry_duration
    if (sourceHoldDuration - destinationHoldDuration < this.minMessageWindow) {
      throw new UnacceptableExpiryError('the difference between the ' +
        'destination expiry duration and the source expiry duration ' +
        'is insufficient to ensure that we can execute the ' +
        'source transfers.')
    }
  }

  _getDestinationExpiry (sourceExpiry) {
    if (!sourceExpiry) return
    const sourceExpiryTime = sourceExpiry.getTime()

    if (sourceExpiryTime < Date.now()) {
      throw new InsufficientTimeoutError('source transfer has already expired. sourceExpiry=' + sourceExpiry.toISOString() + ' currentTime=' + (new Date().toISOString()))
    }

    const destinationExpiryTime = Math.min(sourceExpiryTime - this.minMessageWindow, Date.now() + this.maxHoldTime)

    if ((destinationExpiryTime - Date.now()) < this.minMessageWindow) {
      throw new InsufficientTimeoutError('source transfer expires too soon to complete payment. actualSourceExpiry=' + sourceExpiry.toISOString() + ' requiredSourceExpiry=' + (new Date(Date.now() + 2 * this.minMessageWindow).toISOString()) + ' currentTime=' + (new Date().toISOString()))
    }

    return new Date(destinationExpiryTime)
  }

  _verifyPluginIsConnected (account) {
    if (!this.accounts.getPlugin(account).isConnected()) {
      throw new LedgerNotConnectedError('no connection to account. account=' + account)
    }
  }
}

module.exports = RouteBuilder
