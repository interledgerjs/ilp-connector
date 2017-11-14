'use strict'
const _ = require('lodash')
const BigNumber = require('bignumber.js')
const packet = require('ilp-packet')
const ilpErrors = require('./ilp-errors')
const NoRouteFoundError = require('../errors/no-route-found-error')
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')
const UnacceptableAmountError = require('../errors/unacceptable-amount-error')
const LedgerNotConnectedError = require('../errors/ledger-not-connected-error')
const IncomingTransferError = require('../errors/incoming-transfer-error')
const getDeterministicUuid = require('../lib/utils').getDeterministicUuid
const log = require('../common/log').create('route-builder')
const startsWith = require('lodash/startsWith')

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
  async getDestinationTransfer (sourceTransfer) {
    log.info('constructing destination transfer ' +
      'sourceLedger=%s sourceAmount=%s ilpPacket=%s',
      sourceTransfer.ledger, sourceTransfer.amount, sourceTransfer.ilp)
    if (!sourceTransfer.ilp) {
      throw new IncomingTransferError(ilpErrors.F01_Invalid_Packet({
        message: 'source transfer is missing "ilp"'
      }))
    }
    let ilpPacket
    try {
      ilpPacket = packet.deserializeIlpPayment(Buffer.from(sourceTransfer.ilp, 'base64'))
    } catch (err) {
      log.debug('error parsing ILP packet: ' + sourceTransfer.ilp)
      throw new IncomingTransferError(ilpErrors.F01_Invalid_Packet({
        message: 'source transfer has invalid ILP packet'
      }))
    }
    const destinationAddress = ilpPacket.account
    const myAddress = this.ledgers.getPlugin(sourceTransfer.ledger).getAccount()
    if (startsWith(destinationAddress, myAddress)) {
      log.debug(
        'ignoring transfer addressed to destination which starts with my address destination=%s me=%s',
        destinationAddress,
        myAddress
      )
      return
    }

    log.debug('constructing transfer for ILP packet with account=%s amount=%s',
      ilpPacket.account, ilpPacket.amount)

    const sourceLedger = sourceTransfer.ledger
    const nextHop = await this.quoter.findBestPathForFinalAmount(
      sourceLedger, ilpPacket.account, ilpPacket.amount)
    if (!nextHop) {
      log.info('could not find quote for source transfer: ' + JSON.stringify(sourceTransfer))
      throw new IncomingTransferError(ilpErrors.F02_Unreachable({
        message: 'No route found from: ' + sourceLedger + ' to: ' + ilpPacket.account
      }))
    }
    this._verifyLedgerIsConnected(nextHop.destinationLedger)

    // As long as the fxSpread > slippage, the connector won't lose money.
    const expectedSourceAmount = new BigNumber(nextHop.sourceAmount).times(1 - this.slippage)
    if (expectedSourceAmount.greaterThan(sourceTransfer.amount)) {
      throw new IncomingTransferError(ilpErrors.R01_Insufficient_Source_Amount({
        message: 'Payment rate does not match the rate currently offered'
      }))
    }
    // TODO: Verify atomic mode notaries are trusted
    // TODO: Verify expiry is acceptable

    const noteToSelf = {
      source_transfer_ledger: sourceTransfer.ledger,
      source_transfer_id: sourceTransfer.id,
      source_transfer_amount: sourceTransfer.amount
    }

    // The ID for the next transfer should be deterministically generated, so
    // that the connector doesn't send duplicate outgoing transfers if it
    // receives duplicate notifications.
    //
    // The deterministic generation should ideally be impossible for a third
    // party to predict. Otherwise an attacker might be able to squat on a
    // predicted ID in order to interfere with a payment or make a connector
    // look unreliable. In order to assure this, the connector may use a
    // secret that seeds the deterministic ID generation.
    //
    // If people specifically want to use the same transfer ID though, we'll let them
    const id = this.unwiseUseSameTransferId
      ? sourceTransfer.id
      : getDeterministicUuid(this.secret, sourceTransfer.ledger + '/' + sourceTransfer.id)

    return _.omitBy({
      id,
      ledger: nextHop.destinationLedger,
      direction: 'outgoing',
      from: this.ledgers.getPlugin(nextHop.destinationLedger).getAccount(),
      to: nextHop.destinationCreditAccount,
      amount: nextHop.destinationAmount,
      ilp: sourceTransfer.ilp,
      noteToSelf,
      executionCondition: sourceTransfer.executionCondition,
      cancellationCondition: sourceTransfer.cancellationCondition,
      expiresAt: this._getDestinationExpiry(sourceTransfer.expiresAt),
      cases: sourceTransfer.cases
    }, _.isUndefined)
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
