'use strict'

const isUndefined = require('lodash/fp/isUndefined')
const omitUndefined = require('lodash/fp/omitBy')(isUndefined)
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')

function * makeQuoteQuery (params) {
  return {
    sourceAddress: params.source_address,
    destinationAddress: params.destination_address,
    sourceAmount: params.source_amount,
    destinationAmount: params.destination_amount,
    sourceExpiryDuration: params.source_expiry_duration,
    destinationExpiryDuration: params.destination_expiry_duration,
    slippage: params.slippage,
    explain: params.explain === 'true'
  }
}

// TODO: include the expiry duration in the quote logic
function * validateExpiries (sourceExpiryDuration, destinationExpiryDuration, minMessageWindow, config) {
  // Check destination_expiry_duration
  if (destinationExpiryDuration > config.expiry.maxHoldTime) {
    throw new UnacceptableExpiryError('Destination expiry duration ' +
      'is too long, destinationExpiryDuration: ' + destinationExpiryDuration +
      ', maxHoldTime: ' + config.expiry.maxHoldTime)
  }

  // Check difference between destination_expiry_duration and source_expiry_duration
  if (sourceExpiryDuration - destinationExpiryDuration < minMessageWindow) {
    throw new UnacceptableExpiryError('The difference between the ' +
      'destination expiry duration and the source expiry duration ' +
      'is insufficient to ensure that we can execute the ' +
      'source transfers')
  }
}

/**
 * @param {Object} params
 * @param {String} params.source_address
 * @param {String} params.source_account
 * @param {String} params.source_amount
 * @param {String} params.source_expiry_duration
 * @param {String} params.destination_address
 * @param {String} params.destination_account
 * @param {String} params.destination_amount
 * @param {String} params.destination_expiry_duration
 * @param {String} params.explain
 * @param {String} params.slippage
 * @param {Object} config
 * @param {RouteBuilder} routeBuilder
 * @param {Object} balanceCache
 * @returns {Quote}
 */
function * getQuote (params, config, routeBuilder, balanceCache) {
  const query = yield makeQuoteQuery(params)
  const quote = yield routeBuilder.getQuote(query)

  yield validateExpiries(
    quote.sourceExpiryDuration,
    quote.destinationExpiryDuration,
    quote.minMessageWindow, config)

  return omitUndefined({
    source_ledger: quote.sourceLedger,
    destination_ledger: quote.destinationLedger,
    source_connector_account: quote.connectorAccount,
    source_amount: quote.sourceAmount,
    destination_amount: quote.destinationAmount,
    source_expiry_duration: quote.sourceExpiryDuration,
    destination_expiry_duration: quote.destinationExpiryDuration,
    liquidity_curve: quote.liquidityCurve,
    additional_info: params.explain ? quote.additionalInfo : undefined
  })
}

module.exports = {getQuote}
