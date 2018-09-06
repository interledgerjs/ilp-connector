import BigNumber from 'bignumber.js'
import Accounts from './accounts'
import RoutingTable from './routing-table'
import RateBackend from './rate-backend'
import Config from './config'
import reduct = require('reduct')
import * as IlpPacket from 'ilp-packet'
import { create as createLogger } from '../common/log'
const log = createLogger('route-builder')
const {
  InsufficientTimeoutError,
  InvalidPacketError,
  PeerUnreachableError,
  UnreachableError
} = IlpPacket.Errors

export default class RouteBuilder {
  protected accounts: Accounts
  protected routingTable: RoutingTable
  protected backend: RateBackend
  protected config: Config

  protected isTrivialRate: boolean

  constructor (deps: reduct.Injector) {
    this.accounts = deps(Accounts)
    this.routingTable = deps(RoutingTable)
    this.backend = deps(RateBackend)
    this.config = deps(Config)

    this.isTrivialRate =
      this.config.backend === 'one-to-one' &&
      this.config.spread === 0
  }

  getNextHop (sourceAccount: string, destinationAccount: string) {
    const route = this.routingTable.resolve(destinationAccount)

    if (!route) {
      log.debug('no route found. destinationAccount=' + destinationAccount)
      throw new UnreachableError('no route found. source=' + sourceAccount + ' destination=' + destinationAccount)
    }

    if (!this.config.reflectPayments && sourceAccount === route.nextHop) {
      log.debug('refusing to route payments back to sender. sourceAccount=%s destinationAccount=%s', sourceAccount, destinationAccount)
      throw new UnreachableError('refusing to route payments back to sender. sourceAccount=' + sourceAccount + ' destinationAccount=' + destinationAccount)
    }

    return route.nextHop
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

    const nextHop = this.getNextHop(sourceAccount, destination)

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
