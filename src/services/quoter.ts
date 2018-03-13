import * as IlpPacket from 'ilp-packet'
import Accounts from './accounts'
import Config from './config'
import LiquidityCurve from '../routing/liquidity-curve'
import PrefixMap from '../routing/prefix-map'
import { create as createLogger } from '../common/log'
const log = createLogger('quoter')
import reduct = require('reduct')
const { InternalError } = IlpPacket.Errors

const DESTINATION_HOLD_DURATION = 5000

export interface CachedCurve {
  prefix: string
  curve: LiquidityCurve
  expiry: number
  minMessageWindow: number
}

export default class Quoter {
  protected accounts: Accounts
  protected quoteExpiryDuration: number
  protected cache: PrefixMap<CachedCurve>

  /**
   * @param {Accounts} accounts
   * @param {Object} config
   * @param {Integer} config.quoteExpiry
   */
  constructor (deps: reduct.Injector) {
    this.accounts = deps(Accounts)
    this.quoteExpiryDuration = deps(Config).quoteExpiry // milliseconds
    this.cache = new PrefixMap()
  }

  /**
   * If that matching route has a local curve, it will be returned.
   * Otherwise, make a remote curve quote request.
   *
   * @param {IlpAddress} nextHop
   * @param {IlpAddress} destinationAccount
   * @returns {Object}
   */
  async quoteLiquidity (nextHop: string, destinationAccount: string) {
    const cachedCurve = this.cache.resolve(destinationAccount)

    if (cachedCurve) {
      if (cachedCurve.expiry < Date.now()) {
        log.debug('cleaning up expired cached curve. prefix=%s expiry=%s', cachedCurve.prefix, new Date(cachedCurve.expiry).toISOString())
        this.cache.delete(cachedCurve.prefix)
      } else {
        log.debug('returning cached curve. prefix=%s', cachedCurve.prefix)
        return cachedCurve
      }
    }

    const quoteRequestPacket = IlpPacket.serializeIlqpLiquidityRequest({
      destinationAccount: destinationAccount,
      destinationHoldDuration: DESTINATION_HOLD_DURATION
    })
    const plugin = this.accounts.getPlugin(nextHop)
    log.debug('sending quote request packet. connector=%s', nextHop)
    const quoteResponsePacket = await plugin.sendData(quoteRequestPacket)

    if (quoteResponsePacket[0] === IlpPacket.Type.TYPE_ILQP_LIQUIDITY_RESPONSE) {
      const data = IlpPacket.deserializeIlqpLiquidityResponse(quoteResponsePacket)
      return {
        curve: new LiquidityCurve(data.liquidityCurve),
        prefix: data.appliesToPrefix,
        expiry: new Date(data.expiresAt),
        minMessageWindow: data.sourceHoldDuration - DESTINATION_HOLD_DURATION
      }
    } else {
      throw new InternalError('remote quote error.')
    }
  }

  cacheCurve ({ prefix, curve, expiry, minMessageWindow }: CachedCurve) {
    log.debug('caching curve. prefix=%s expiry=%s minMessageWindow=%s', prefix, expiry, minMessageWindow)
    this.cache.insert(prefix, {
      prefix,
      curve,
      expiry,
      minMessageWindow
    })
  }
}
