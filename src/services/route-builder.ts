import BigNumber from 'bignumber.js'
import Accounts from './accounts'
import RoutingTable from './routing-table'
import RateBackend from './rate-backend'
import Quoter from './quoter'
import Config from './config'
import LiquidityCurve from '../routing/liquidity-curve'
import reduct = require('reduct')
import * as IlpPacket from 'ilp-packet'
import { create as createLogger } from '../common/log'
const log = createLogger('route-builder')
const {
  BadRequestError,
  InsufficientTimeoutError,
  InvalidAmountError,
  InvalidPacketError,
  PeerUnreachableError,
  UnreachableError
} = IlpPacket.Errors

const PROBE_AMOUNT = new BigNumber(10).pow(14).toNumber() // stays within 15 max digits for BigNumber from Number

function rateToCurve (rate: number) {
  // Make sure that neither amount exceeds 15 significant digits.
  if (rate > 1) {
    return new LiquidityCurve([ [0, 0], [ PROBE_AMOUNT / rate, PROBE_AMOUNT ] ])
  } else {
    return new LiquidityCurve([ [0, 0], [ PROBE_AMOUNT, PROBE_AMOUNT * rate ] ])
  }
}

export interface QuoteLiquidityParams extends IlpPacket.IlqpLiquidityRequest {
  sourceAccount: string
}

export interface QuoteBySourceParams extends IlpPacket.IlqpBySourceRequest {
  sourceAccount: string
}

export interface QuoteByDestinationParams extends IlpPacket.IlqpByDestinationRequest {
  sourceAccount: string
}

export default class RouteBuilder {
  protected accounts: Accounts
  protected routingTable: RoutingTable
  protected backend: RateBackend
  protected quoter: Quoter
  protected config: Config

  protected isTrivialRate: boolean

  constructor (deps: reduct.Injector) {
    this.accounts = deps(Accounts)
    this.routingTable = deps(RoutingTable)
    this.backend = deps(RateBackend)
    this.quoter = deps(Quoter)
    this.config = deps(Config)

    this.isTrivialRate =
      this.config.backend === 'one-to-one' &&
      this.config.spread === 0
  }

  getNextHop (sourceAccount: string, destinationAccount: string) {
    const route = this.routingTable.resolve(destinationAccount)

    if (!route) {
      log.debug('no route found for quote. destinationAccount=' + destinationAccount)
      throw new UnreachableError('no route found. to=' + destinationAccount)
    }

    if (!this.config.reflectPayments && sourceAccount === route.nextHop) {
      log.debug('refusing to route payments back to sender. sourceAccount=%s destinationAccount=%s', sourceAccount, destinationAccount)
      throw new UnreachableError('refusing to route payments back to sender. sourceAccount=' + sourceAccount + ' destinationAccount=' + destinationAccount)
    }

    return route.nextHop
  }

  async quoteLocal (sourceAccount: string, destinationAccount: string) {
    if (!this.accounts.getAssetCode(sourceAccount)) {
      log.debug('source account is unavailable. sourceAccount=' + sourceAccount)
      throw new UnreachableError('no route from source. sourceAccount=' + sourceAccount)
    }

    const nextHop = this.getNextHop(sourceAccount, destinationAccount)

    if (!this.accounts.getAssetCode(nextHop)) {
      log.debug('next hop is unavailable. nextHop=' + nextHop)
      throw new UnreachableError('no route to next hop. nextHop=' + nextHop)
    }

    log.trace('determined next hop. nextHop=' + nextHop)

    const rate = await this.backend.getRate(sourceAccount, nextHop)

    log.trace('determined local rate. rate=' + rate)

    return { nextHop, rate }
  }

  /**
   * @param {String} sourceAccount
   * @param {Object} packet
   * @param {String} packet.destinationAccount
   * @param {Number} packet.destinationHoldDuration
   * @returns {QuoteLiquidityResponse}
   */
  async quoteLiquidity (sourceAccount: string, packet: IlpPacket.IlqpLiquidityRequest) {
    log.trace('creating liquidity quote. sourceAccount=%s destinationAccount=%s',
      sourceAccount, packet.destinationAccount)

    const { nextHop, rate } = await this.quoteLocal(sourceAccount, packet.destinationAccount)
    const localQuoteExpiry = Date.now() + (this.config.quoteExpiry)

    const localCurve = rateToCurve(rate)

    let liquidityCurve
    let appliesToPrefix
    let sourceHoldDuration
    let expiresAt
    if (packet.destinationAccount.startsWith(nextHop)) {
      log.trace('local destination.')
      liquidityCurve = localCurve
      appliesToPrefix = nextHop
      sourceHoldDuration = packet.destinationHoldDuration + this.config.minMessageWindow
      expiresAt = localQuoteExpiry
    } else {
      const quote = await this.quoter.quoteLiquidity(nextHop, packet.destinationAccount)
      if (!quote) {
        log.debug('no quote found. sourceAccount=%s params=%j', sourceAccount, packet)
        throw new UnreachableError('no quote found. to=' + packet.destinationAccount)
      }
      log.trace('remote destination. quote=%j', quote)

      liquidityCurve = localCurve.join(quote.curve)
      appliesToPrefix = quote.prefix
      sourceHoldDuration = packet.destinationHoldDuration + quote.minMessageWindow + this.config.minMessageWindow
      expiresAt = Math.min(Number(quote.expiry), localQuoteExpiry)
    }

    this._verifyPluginIsConnected(nextHop)
    this._validateHoldDurations(sourceHoldDuration, packet.destinationHoldDuration)

    const shiftBy = this._getScaleAdjustment(sourceAccount, nextHop)

    return {
      // Shifting the curve right by one unit effectively makes it so the client
      // always sends enough money even despite rounding errors.
      liquidityCurve: liquidityCurve.shiftX(shiftBy).toBuffer(),
      // We need to say which prefix this curve applies to. But for that
      // prefix, the curve must ALWAYS apply because people may cache it.
      // So we need the shortest prefix of the destination for which this
      // cached curve will ALWAYS apply.
      appliesToPrefix: this.routingTable.getShortestUnambiguousPrefix(packet.destinationAccount, appliesToPrefix),
      sourceHoldDuration,
      expiresAt: new Date(expiresAt)
    }
  }

  _getScaleAdjustment (sourceAccount: string, destinationAccount: string) {
    const sourceScale = this.accounts.getInfo(sourceAccount).assetScale
    const destinationScale = this.accounts.getInfo(destinationAccount).assetScale
    if (sourceScale === destinationScale && this.isTrivialRate) return 0
    return 1
  }

  /**
   * @param {String} sourceAccount
   * @param {Object} packet
   * @param {String} packet.destinationAccount
   * @param {Number} packet.destinationHoldDuration
   * @param {String} packet.sourceAmount
   * @returns {QuoteBySourceResponse}
   */
  async quoteBySource (sourceAccount: string, packet: IlpPacket.IlqpBySourceRequest) {
    log.trace('creating quote by source amount. sourceAccount=%s destinationAccount=%s sourceAmount=%s',
      sourceAccount, packet.destinationAccount, packet.sourceAmount)

    if (packet.sourceAmount === '0') {
      throw new InvalidAmountError('sourceAmount must be positive')
    }

    const { nextHop, rate } = await this.quoteLocal(sourceAccount, packet.destinationAccount)

    const nextAmount = new BigNumber(packet.sourceAmount).times(rate).integerValue(BigNumber.ROUND_FLOOR).toString()
    let destinationAmount
    let sourceHoldDuration
    if (packet.destinationAccount.startsWith(nextHop)) {
      log.trace('local destination. destinationAmount=' + nextAmount)
      destinationAmount = nextAmount
      sourceHoldDuration = packet.destinationHoldDuration + this.config.minMessageWindow
    } else {
      const quote = await this.quoter.quoteLiquidity(nextHop, packet.destinationAccount)
      if (!quote) {
        log.debug('no quote found. sourceAccount=%s params=%j', sourceAccount, packet)
        throw new UnreachableError('no quote found. to=' + packet.destinationAccount)
      }
      log.trace('remote destination. quote=%j', quote)

      destinationAmount = quote.curve.amountAt(packet.sourceAmount).times(rate).integerValue(BigNumber.ROUND_FLOOR).toString()
      sourceHoldDuration = packet.destinationHoldDuration + quote.minMessageWindow + this.config.minMessageWindow
    }

    if (destinationAmount === '0') {
      throw new InvalidAmountError('quoted destination is lower than minimum amount allowed.')
    }

    this._verifyPluginIsConnected(sourceAccount)
    this._verifyPluginIsConnected(nextHop)
    this._validateHoldDurations(sourceHoldDuration, packet.destinationHoldDuration)

    return {
      destinationAmount,
      sourceHoldDuration
    }
  }

  /**
   * @param {String} sourceAccount
   * @param {Object} packet
   * @param {String} packet.destinationAccount
   * @param {Number} packet.destinationHoldDuration
   * @param {String} packet.destinationAmount
   * @returns {QuoteByDestinationResponse}
   */
  async quoteByDestination (sourceAccount: string, packet: IlpPacket.IlqpByDestinationRequest) {
    log.trace('creating quote by destination amount. sourceAccount=%s destinationAccount=%s destinationAmount=%s',
      sourceAccount, packet.destinationAccount, packet.destinationAmount)

    if (packet.destinationAmount === '0') {
      throw new InvalidAmountError('destinationAmount must be positive')
    }

    const { nextHop, rate } = await this.quoteLocal(sourceAccount, packet.destinationAccount)

    let nextHopAmount
    let nextHopHoldDuration
    if (packet.destinationAccount.startsWith(nextHop)) {
      log.trace('local destination.')
      nextHopAmount = packet.destinationAmount
      nextHopHoldDuration = packet.destinationHoldDuration
    } else {
      const quote = await this.quoter.quoteLiquidity(nextHop, packet.destinationAccount)
      if (!quote) {
        log.debug('no quote found. sourceAccount=%s params=%j', sourceAccount, packet)
        throw new UnreachableError('no quote found. to=' + packet.destinationAccount)
      }
      log.trace('remote destination. quote=%j', quote)

      nextHopAmount = quote.curve.amountReverse(packet.destinationAmount).toString()
      nextHopHoldDuration = packet.destinationHoldDuration + quote.minMessageWindow
    }

    const sourceAmount = new BigNumber(nextHopAmount).div(rate).integerValue(BigNumber.ROUND_CEIL).toString()
    const sourceHoldDuration = nextHopHoldDuration + this.config.minMessageWindow
    if (sourceAmount === '0') {
      throw new InvalidAmountError('Quoted source is lower than minimum amount allowed')
    }
    this._verifyPluginIsConnected(sourceAccount)
    this._verifyPluginIsConnected(nextHop)
    this._validateHoldDurations(sourceHoldDuration, packet.destinationHoldDuration)
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
  async getNextHopPacket (sourceAccount: string, sourcePacket: IlpPacket.IlpPrepare) {
    const {
      amount,
      executionCondition,
      expiresAt,
      destination,
      data
    } = sourcePacket

    log.trace(
      'constructing next hop packet. sourceAccount=%s sourceAmount=%s destination=%s',
      sourceAccount, amount, destination
    )

    if (destination.length < 1) {
      throw new InvalidPacketError('missing destination.')
    }

    const route = this.routingTable.resolve(destination)

    if (!route) {
      log.debug('could not find route for transfer. sourceAccount=%s sourceAmount=%s destinationAccount=%s', sourceAccount, amount, destination)
      throw new UnreachableError('no route found. source=' + sourceAccount + ' destination=' + destination)
    }

    const nextHop = route.nextHop

    log.trace('determined next hop. nextHop=%s', nextHop)

    const rate = await this.backend.getRate(sourceAccount, nextHop)

    log.trace('determined local rate. rate=%s', rate)

    this._verifyPluginIsConnected(nextHop)

    const nextAmount = new BigNumber(amount).times(rate).integerValue(BigNumber.ROUND_FLOOR)

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
  _validateHoldDurations (sourceHoldDuration: number, destinationHoldDuration: number) {
    // Check destination_expiry_duration
    if (destinationHoldDuration > this.config.maxHoldTime) {
      throw new BadRequestError('destination expiry duration ' +
        'is too long. destinationHoldDuration=' + destinationHoldDuration +
        ' maxHoldTime=' + this.config.maxHoldTime)
    }

    // Check difference between destination_expiry_duration and source_expiry_duration
    if (sourceHoldDuration - destinationHoldDuration < this.config.minMessageWindow) {
      throw new BadRequestError('the difference between the ' +
        'destination expiry duration and the source expiry duration ' +
        'is insufficient to ensure that we can execute the ' +
        'source transfers.')
    }
  }

  _getDestinationExpiry (sourceExpiry: Date) {
    if (!sourceExpiry) {
      throw new TypeError('source expiry must be a Date')
    }
    const sourceExpiryTime = sourceExpiry.getTime()

    if (sourceExpiryTime < Date.now()) {
      throw new InsufficientTimeoutError('source transfer has already expired. sourceExpiry=' + sourceExpiry.toISOString() + ' currentTime=' + (new Date().toISOString()))
    }

    // We will set the next transfer's expiry based on the source expiry and our
    // minMessageWindow, but cap it at our maxHoldTime.
    const destinationExpiryTime = Math.min(sourceExpiryTime - this.config.minMessageWindow, Date.now() + this.config.maxHoldTime)

    if ((destinationExpiryTime - Date.now()) < this.config.minMessageWindow) {
      throw new InsufficientTimeoutError('source transfer expires too soon to complete payment. actualSourceExpiry=' + sourceExpiry.toISOString() + ' requiredSourceExpiry=' + (new Date(Date.now() + 2 * this.config.minMessageWindow).toISOString()) + ' currentTime=' + (new Date().toISOString()))
    }

    return new Date(destinationExpiryTime)
  }

  _verifyPluginIsConnected (account: string) {
    if (!this.accounts.getPlugin(account).isConnected()) {
      throw new PeerUnreachableError('no connection to account. account=' + account)
    }
  }
}
