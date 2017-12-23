'use strict'

const _ = require('lodash')
const BigNumber = require('bignumber.js')
const packet = require('ilp-packet')
const { codes, createIlpRejection } = require('./ilp-errors')
const NoRouteFoundError = require('../errors/no-route-found-error')
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')
const UnacceptableAmountError = require('../errors/unacceptable-amount-error')
const LedgerNotConnectedError = require('../errors/ledger-not-connected-error')
const InvalidAmountSpecifiedError = require('../errors/invalid-amount-specified-error')
const LiquidityCurve = require('../routing/liquidity-curve')
const log = require('../common/log').create('route-builder')
const { getShortestUnambiguousPrefix } = require('./utils')

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
  /**
   * @param {Accounts} accounts
   * @param {PrefixMap} routingTable
   * @param {Backend} backend
   * @param {Quoter} quoter
   * @param {Object} config
   * @param {Integer} config.minMessageWindow seconds
   * @param {Integer} config.maxHoldTime seconds
   * @param {Number} config.slippage
   */
  constructor (accounts, routingTable, backend, quoter, config) {
    if (!accounts) {
      throw new TypeError('Must be given a valid Accounts instance')
    }

    this.accounts = accounts
    this.routingTable = routingTable
    this.backend = backend
    this.quoter = quoter
    this.minMessageWindow = config.minMessageWindow * 1000 // millseconds
    this.maxHoldTime = config.maxHoldTime * 1000 // millseconds
    this.quoteExpiryDuration = config.quoteExpiry // milliseconds
    this.slippage = config.slippage
    this.secret = config.secret
    this.reflectPayments = config.reflectPayments
    this.createIlpRejection = createIlpRejection.bind(null, config.address || '')
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
    const sourceScale = this.accounts.getPlugin(sourceAccount).getInfo().currencyScale
    const destinationScale = this.accounts.getPlugin(destinationAccount).getInfo().currencyScale
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

      if (destinationAmount === '0') {
        throw new UnacceptableAmountError('Quoted destination is lower than minimum amount allowed')
      }
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
   * Given a source transfer with an embedded final transfer, get the next
   * transfer in the chain.
   *
   * It works as follows:
   * Given `sourceTransfer` A→C, find the next hop B on the route from A to C.
   * If the next hop is the final one (B == C), return the final transfer.
   * Otherwise, return a transfer at B, with the final transfer C embedded.
   *
   * @param {Transfer} sourceTransfer
   * @returns {Transfer} destinationTransfer
   */
  async getDestinationTransfer (sourceAccount, sourceTransfer) {
    let ilpPacket
    try {
      ilpPacket = packet.deserializeIlpPacket(sourceTransfer.ilp)
    } catch (err) {
      const errInfo = (typeof err === 'object' && err.stack) ? err.stack : err
      log.debug('error parsing ILP packet ' + sourceTransfer.ilp.toString('base64') + ' - ' + errInfo)
      throw this.createIlpRejection({
        code: codes.F01_INVALID_PACKET,
        message: 'Source transfer has invalid ILP packet'
      })
    }
    log.info('constructing destination transfer. ' +
      'sourceAccount=%s sourceAmount=%s destination=%s',
      sourceAccount, sourceTransfer.amount, ilpPacket.data.account)

    if (ilpPacket.type === packet.Type.TYPE_ILP_PAYMENT) {
      log.debug('routing ilp delivered amount packet.')
    } else if (ilpPacket.type === packet.Type.TYPE_ILP_FORWARDED_PAYMENT) {
      log.debug('routing ilp forwarded packet.')
    } else {
      throw this.createIlpRejection({
        code: codes.F01_INVALID_PACKET,
        message: 'invalid packet type. type=' + ilpPacket.type
      })
    }

    if (ilpPacket.data.account.length < 1) {
      throw this.createIlpRejection({
        code: codes.F01_INVALID_PACKET,
        message: 'missing destination.'
      })
    }

    const nextHop = this.routingTable.resolve(ilpPacket.data.account)

    if (!nextHop) {
      log.info(`could not find route for transfer. sourceAccount=${sourceAccount} sourceAmount=${sourceTransfer.amount} destinationAccount=${ilpPacket.data.account}`)
      throw this.createIlpRejection({
        code: codes.F02_UNREACHABLE,
        message: 'no route found. source=' + sourceAccount + ' destination=' + ilpPacket.data.account
      })
    }

    log.debug('determined next hop. nextHop=' + nextHop)

    const rate = await this.backend.getRate(sourceAccount, nextHop)

    log.debug('determined local rate. rate=' + rate)

    this._verifyPluginIsConnected(nextHop)

    let nextAmount = new BigNumber(sourceTransfer.amount).times(rate).floor()
    if (ilpPacket.type === packet.Type.TYPE_ILP_PAYMENT && this.accounts.isLocal(ilpPacket.data.account)) {
      // Make sure that we would have delivered more than the fixed amount
      // requested.
      if (nextAmount.lessThan(ilpPacket.data.amount)) {
        throw this.createIlpRejection({
          code: codes.R01_INSUFFICIENT_SOURCE_AMOUNT,
          message: 'Payment rate does not match the rate currently offered'
        })
      }

      nextAmount = ilpPacket.data.amount
    }

    // TODO: Verify atomic mode notaries are trusted

    const custom = {}

    // Carry forward atomic mode fields
    if (sourceTransfer.custom && sourceTransfer.custom.cancellationCondition) {
      custom.cancellationCondition = sourceTransfer.custom.cancellationCondition
    }
    if (sourceTransfer.custom && sourceTransfer.custom.cases) {
      custom.cases = sourceTransfer.custom.cases
    }

    return {
      destinationAccount: nextHop,
      destinationTransfer: _.omitBy({
        amount: nextAmount.toString(),
        ilp: sourceTransfer.ilp,
        executionCondition: sourceTransfer.executionCondition,
        expiresAt: this._getDestinationExpiry(sourceTransfer.expiresAt),
        custom
      }, _.isUndefined)
    }
  }

  // TODO: include the expiry duration in the quote logic
  _validateHoldDurations (sourceHoldDuration, destinationHoldDuration) {
    // Check destination_expiry_duration
    if (destinationHoldDuration > this.maxHoldTime) {
      throw new UnacceptableExpiryError('Destination expiry duration ' +
        'is too long, destinationHoldDuration: ' + destinationHoldDuration +
        ', maxHoldTime: ' + this.maxHoldTime)
    }

    // Check difference between destination_expiry_duration and source_expiry_duration
    if (sourceHoldDuration - destinationHoldDuration < this.minMessageWindow) {
      throw new UnacceptableExpiryError('The difference between the ' +
        'destination expiry duration and the source expiry duration ' +
        'is insufficient to ensure that we can execute the ' +
        'source transfers')
    }
  }

  _getDestinationExpiry (sourceExpiry) {
    if (!sourceExpiry) return
    const sourceExpiryTime = (new Date(sourceExpiry)).getTime()

    if (sourceExpiryTime < Date.now()) {
      throw this.createIlpRejection({
        code: codes.R02_INSUFFICIENT_TIMEOUT,
        message: 'source transfer has already expired. sourceExpiry=' + sourceExpiry + ' currentTime=' + (new Date().toISOString())
      })
    }

    const destinationExpiryTime = Math.min(sourceExpiryTime - this.minMessageWindow, Date.now() + this.maxHoldTime)

    if ((destinationExpiryTime - Date.now()) < this.minMessageWindow) {
      throw this.createIlpRejection({
        code: codes.R02_INSUFFICIENT_TIMEOUT,
        message: 'source transfer expires too soon to complete payment. actualSourceExpiry=' + sourceExpiry + ' requiredSourceExpiry=' + (new Date(Date.now() + 2 * this.minMessageWindow).toISOString()) + ' currentTime=' + (new Date().toISOString())
      })
    }

    return (new Date(destinationExpiryTime)).toISOString()
  }

  _verifyPluginIsConnected (account) {
    if (!this.accounts.getPlugin(account).isConnected()) {
      throw new LedgerNotConnectedError('no connection to account. account=' + account)
    }
  }
}

module.exports = RouteBuilder
