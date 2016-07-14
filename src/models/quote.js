'use strict'

const request = require('co-request')
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')
const UnacceptableAmountError = require('../errors/unacceptable-amount-error')
const AssetsNotTradedError = require('../errors/assets-not-traded-error')
const ExternalError = require('../errors/external-error')
const DEFAULT_DESTINATION_EXPIRY = 5 // seconds

function * makeQuoteQuery (params) {
  const sourceLedger = params.source_ledger ||
    (yield getAccountLedger(params.source_account))
  const destinationLedger = params.destination_ledger ||
    (yield getAccountLedger(params.destination_account))
  const explain = params.explain === 'true'
  return {
    sourceLedger,
    destinationLedger,
    sourceAmount: params.source_amount,
    destinationAmount: params.destination_amount,
    explain
  }
}

function * getAccountLedger (account) {
  const res = yield request({
    method: 'get',
    uri: account,
    json: true
  })
  const ledger = res.body && res.body.ledger
  if (res.statusCode !== 200 || !ledger) {
    throw new ExternalError('Unable to identify ledger from account: ' + account)
  }
  return ledger
}

/**
 * @param {String} _sourceExpiryDuration
 * @param {String} _destinationExpiryDuration
 * @param {Number} minMessageWindow
 * @param {Config} config
 * @returns {Object} {sourceExpiryDuration: Number, destinationExpiryDuration: Number}
 */
function getQuoteExpiryDurations (_sourceExpiryDuration, _destinationExpiryDuration, minMessageWindow, config) {
  // TODO: include the expiry duration in the quote logic
  let destinationExpiryDuration = parseFloat(_destinationExpiryDuration)
  let sourceExpiryDuration = parseFloat(_sourceExpiryDuration)

  // Check destination_expiry_duration
  if (destinationExpiryDuration) {
    if (destinationExpiryDuration > config.getIn(['expiry', 'maxHoldTime'])) {
      throw new UnacceptableExpiryError('Destination expiry duration ' +
        'is too long, destinationExpiryDuration: ' + destinationExpiryDuration +
        ', maxHoldTime: ' + config.getIn(['expiry', 'maxHoldTime']))
    }
  } else if (sourceExpiryDuration) {
    destinationExpiryDuration = sourceExpiryDuration - minMessageWindow
  } else {
    destinationExpiryDuration = DEFAULT_DESTINATION_EXPIRY
  }

  // Check difference between destination_expiry_duration
  // and source_expiry_duration
  if (sourceExpiryDuration) {
    if (sourceExpiryDuration - destinationExpiryDuration < minMessageWindow) {
      throw new UnacceptableExpiryError('The difference between the ' +
        'destination expiry duration and the source expiry duration ' +
        'is insufficient to ensure that we can execute the ' +
        'source transfers')
    }
  } else {
    sourceExpiryDuration = destinationExpiryDuration + minMessageWindow
  }

  return {sourceExpiryDuration, destinationExpiryDuration}
}

function * validateBalance (balanceCache, ledger, amount) {
  const balance = yield balanceCache.get(ledger)
  if (balance.lessThan(amount)) {
    throw new UnacceptableAmountError('Insufficient liquidity in market maker account')
  }
}

/**
 * @param {Object} params
 * @param {String} params.source_ledger
 * @param {String} params.source_account
 * @param {String} params.source_amount
 * @param {String} params.source_expiry_duration
 * @param {String} params.destination_ledger
 * @param {String} params.destination_account
 * @param {String} params.destination_amount
 * @param {String} params.destination_expiry_duration
 * @param {Object} config
 * @param {Object} balanceCache
 * @returns {Quote}
 */
function * getQuote (params, config, routeBuilder, balanceCache) {
  const query = yield makeQuoteQuery(params)
  if (query.sourceLedger === query.destinationLedger) {
    throw new AssetsNotTradedError('source_ledger must be different from destination_ledger')
  }

  const quote = yield routeBuilder.getQuote(query)
  const nextHop = quote._hop
  delete quote._hop

  const expiryDurations = getQuoteExpiryDurations(
    params.source_expiry_duration,
    params.destination_expiry_duration,
    nextHop.minMessageWindow, config)
  quote.source_expiry_duration = String(expiryDurations.sourceExpiryDuration)
  quote.destination_expiry_duration = String(expiryDurations.destinationExpiryDuration)

  // Check the balance of the next ledger (_not_ query.destinationLedger, which is the final ledger).
  yield validateBalance(balanceCache, nextHop.destinationLedger, nextHop.destinationAmount)
  return quote
}

module.exports = {getQuote}
