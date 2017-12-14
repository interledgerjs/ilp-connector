'use strict'
const _ = require('lodash')
const BigNumber = require('bignumber.js')
const packet = require('ilp-packet')
const { codes, createIlpError } = require('./ilp-errors')
const NoRouteFoundError = require('../errors/no-route-found-error')
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')
const UnacceptableAmountError = require('../errors/unacceptable-amount-error')
const LedgerNotConnectedError = require('../errors/ledger-not-connected-error')
const log = require('../common/log').create('route-builder')

const VALID_PAYMENT_PACKETS = [
  packet.Type.TYPE_ILP_PAYMENT,
  packet.Type.TYPE_ILP_FORWARDED_PAYMENT
]

class RouteBuilder {
  /**
   * @param {Ledgers} ledgers
   * @param {Quoter} quoter
   * @param {Object} config
   * @param {Integer} config.minMessageWindow seconds
   * @param {Integer} config.maxHoldTime seconds
   * @param {Number} config.slippage
   */
  constructor (ledgers, quoter, config) {
    if (!ledgers) {
      throw new TypeError('Must be given a valid Ledgers instance')
    }

    this.ledgers = ledgers
    this.routingTables = ledgers.tables
    this.quoter = quoter
    this.minMessageWindow = config.minMessageWindow * 1000 // millseconds
    this.maxHoldTime = config.maxHoldTime * 1000 // millseconds
    this.slippage = config.slippage
    this.secret = config.secret
    this.unwiseUseSameTransferId = config.unwiseUseSameTransferId
    this.createIlpError = createIlpError.bind(null, config.account || '')
  }

  /**
   * @param {Object} params
   * @param {String} params.sourceAccount
   * @param {String} params.destinationAccount
   * @param {Number} params.destinationHoldDuration
   * @returns {QuoteLiquidityResponse}
   */
  async quoteLiquidity (params) {
    log.info('creating quote sourceAccount=%s destinationAccount=%s',
      params.sourceAccount, params.destinationAccount)
    const quote = await this.quoter.quoteLiquidity({
      sourceAccount: params.sourceAccount,
      destinationAccount: params.destinationAccount,
      destinationHoldDuration: params.destinationHoldDuration
    })
    if (!quote) {
      log.info('no quote found for params: ' + JSON.stringify(params))
      throw new NoRouteFoundError('No route found from: ' + params.sourceAccount + ' to: ' + params.destinationAccount)
    }
    this._verifyLedgerIsConnected(quote.route.sourceLedger)
    this._validateHoldDurations(quote.sourceHoldDuration, params.destinationHoldDuration)
    return {
      liquidityCurve: quote.liquidityCurve,
      appliesToPrefix: quote.appliesToPrefix,
      sourceHoldDuration: quote.sourceHoldDuration,
      expiresAt: quote.expiresAt
    }
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
    log.info('creating quote sourceAccount=%s destinationAccount=%s sourceAmount=%s',
      params.sourceAccount, params.destinationAccount, params.sourceAmount)
    const quote = await this.quoter.quoteBySourceAmount({
      sourceAccount: params.sourceAccount,
      destinationAccount: params.destinationAccount,
      destinationHoldDuration: params.destinationHoldDuration,
      sourceAmount: params.sourceAmount
    })
    if (!quote) {
      log.info('no quote found for params: ' + JSON.stringify(params))
      throw new NoRouteFoundError('No route found from: ' + params.sourceAccount + ' to: ' + params.destinationAccount)
    }
    if (quote.destinationAmount === '0') {
      throw new UnacceptableAmountError('Quoted destination is lower than minimum amount allowed')
    }
    this._verifyLedgerIsConnected(quote.route.sourceLedger)
    this._verifyLedgerIsConnected(quote.route.nextLedger)
    this._validateHoldDurations(quote.sourceHoldDuration, params.destinationHoldDuration)
    return {
      destinationAmount: quote.destinationAmount,
      sourceHoldDuration: quote.sourceHoldDuration
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
    log.info('creating quote sourceAccount=%s destinationAccount=%s destinationAmount=%s',
      params.sourceAccount, params.destinationAccount, params.destinationAmount)
    const quote = await this.quoter.quoteByDestinationAmount({
      sourceAccount: params.sourceAccount,
      destinationAccount: params.destinationAccount,
      destinationHoldDuration: params.destinationHoldDuration,
      destinationAmount: params.destinationAmount
    })
    if (!quote) {
      log.info('no quote found for params: ' + JSON.stringify(params))
      throw new NoRouteFoundError('No route found from: ' + params.sourceAccount + ' to: ' + params.destinationAccount)
    }
    if (quote.sourceAmount === '0') {
      throw new UnacceptableAmountError('Quoted source is lower than minimum amount allowed')
    }
    this._verifyLedgerIsConnected(quote.route.sourceLedger)
    this._verifyLedgerIsConnected(quote.route.nextLedger)
    this._validateHoldDurations(quote.sourceHoldDuration, params.destinationHoldDuration)
    return {
      sourceAmount: quote.sourceAmount,
      sourceHoldDuration: quote.sourceHoldDuration
    }
  }

  async getNextHopFromIlpPacket (sourceLedger, sourceAmount, ilp) {
    let ilpPacket
    try {
      ilpPacket = packet.deserializeIlpPacket(ilp)
    } catch (err) {
      const errInfo = (typeof err === 'object' && err.stack) ? err.stack : err
      log.debug('error parsing ILP packet ' + ilp.toString('base64') + ' - ' + errInfo)
      throw this.createIlpError({
        code: codes.F01_INVALID_PACKET,
        message: 'Source transfer has invalid ILP packet'
      })
    }

    if (VALID_PAYMENT_PACKETS.indexOf(ilpPacket.type) === -1) {
      throw this.createIlpError({
        code: codes.F01_INVALID_PACKET,
        message: 'Invalid packet type'
      })
    }

    if (ilpPacket.data.account.length === 0) {
      throw this.createIlpError({
        code: codes.F01_INVALID_PACKET,
        message: 'Missing destination'
      })
    }

    log.info('constructing destination transfer ' +
      'sourceLedger=%s sourceAmount=%s destination=%s',
      sourceLedger, sourceAmount, ilpPacket.data.account)

    let nextHop
    if (ilpPacket.type === packet.Type.TYPE_ILP_PAYMENT) {
      nextHop = await this.quoter.findBestPathForFinalAmount(
        sourceLedger,
        ilpPacket.data.account,
        ilpPacket.data.amount
      )
    } else if (ilpPacket.type === packet.Type.TYPE_ILP_FORWARDED_PAYMENT) {
      nextHop = await this.quoter.findBestPathForSourceAmount(
        sourceLedger,
        ilpPacket.data.account,
        sourceAmount
      )
    }

    if (!nextHop) {
      log.info(`could not find quote for transfer. sourceLedger=${sourceLedger} sourceAmount=${sourceAmount} ilp=${ilp.toString('base64')}`)
      throw this.createIlpError({
        code: codes.F02_UNREACHABLE,
        message: 'No route found from: ' + sourceLedger + ' to: ' + ilpPacket.data.account
      })
    }

    return nextHop
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
  async getDestinationTransfer (sourceLedger, sourceTransfer) {
    const nextHop = await this.getNextHopFromIlpPacket(sourceLedger, sourceTransfer.amount, sourceTransfer.ilp)

    this._verifyLedgerIsConnected(nextHop.destinationLedger)

    // As long as the fxSpread > slippage, the connector won't lose money.
    const expectedSourceAmount = new BigNumber(nextHop.sourceAmount).times(1 - this.slippage)
    if (expectedSourceAmount.greaterThan(sourceTransfer.amount)) {
      throw this.createIlpError({
        code: codes.R01_INSUFFICIENT_SOURCE_AMOUNT,
        message: 'Payment rate does not match the rate currently offered'
      })
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
      destinationLedger: nextHop.destinationLedger,
      destinationTransfer: _.omitBy({
        amount: nextHop.destinationAmount,
        ilp: sourceTransfer.ilp,
        executionCondition: sourceTransfer.executionCondition,
        expiresAt: this._getDestinationExpiry(sourceTransfer.expiresAt),
        custom
      }, _.isUndefined)
    }
  }

  _getDestinationExpiry (sourceExpiry) {
    if (!sourceExpiry) return
    const sourceExpiryTime = (new Date(sourceExpiry)).getTime()
    return (new Date(sourceExpiryTime - this.minMessageWindow)).toISOString()
  }

  _verifyLedgerIsConnected (ledger) {
    if (!this.ledgers.getPlugin(ledger).isConnected()) {
      throw new LedgerNotConnectedError('No connection to ledger "' + ledger + '"')
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
}

module.exports = RouteBuilder
