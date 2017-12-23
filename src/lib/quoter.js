'use strict'

const IlpPacket = require('ilp-packet')
const InterledgerRejectionError = require('../errors/interledger-rejection-error')
const LiquidityCurve = require('../routing/liquidity-curve')
const PrefixMap = require('../routing/prefix-map')
const log = require('../common').log.create('quoter')

const DESTINATION_HOLD_DURATION = 5000

class Quoter {
  /**
   * @param {Accounts} accounts
   * @param {Object} config
   * @param {Integer} config.quoteExpiry
   */
  constructor (accounts, config) {
    this.accounts = accounts
    this.quoteExpiryDuration = config.quoteExpiry // milliseconds
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
  async quoteLiquidity (nextHop, destinationAccount) {
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
    const response = await plugin.sendRequest({
      ilp: quoteRequestPacket.toString('base64')
    })
    const quoteResponsePacket = Buffer.from(response.ilp, 'base64')

    if (quoteResponsePacket[0] === IlpPacket.Type.TYPE_ILQP_LIQUIDITY_RESPONSE) {
      const { data } = IlpPacket.deserializeIlpPacket(quoteResponsePacket)
      return {
        curve: new LiquidityCurve(data.liquidityCurve),
        prefix: data.appliesToPrefix,
        expiry: new Date(data.expiresAt),
        minMessageWindow: data.sourceHoldDuration - DESTINATION_HOLD_DURATION
      }
    } else {
      throw new InterledgerRejectionError({
        message: 'remote quote error.',
        ilpRejection: quoteResponsePacket
      })
    }
  }

  cacheCurve ({ prefix, curve, expiry, minMessageWindow }) {
    log.debug('caching curve. prefix=%s expiry=%s minMessageWindow=%s', prefix, expiry, minMessageWindow)
    this.cache.insert(prefix, {
      prefix,
      curve,
      expiry,
      minMessageWindow
    })
  }
}

module.exports = Quoter
