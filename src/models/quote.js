'use strict'

const request = require('co-request')
const _ = require('lodash')
const BigNumber = require('bignumber.js')
const log = require('../common').log('quote')
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')
const UnacceptableAmountError = require('../errors/unacceptable-amount-error')
const InvalidURIParameterError = require('five-bells-shared').InvalidUriParameterError
const ExternalError = require('../errors/external-error')
const balanceCache = require('../services/balance-cache.js')
const backend = require('../services/backend')

function * getPrecisionAndScale (ledger) {
  log.debug('getPrecisionAndScale', ledger)
  function throwErr () {
    throw new ExternalError('Unable to determine ledger precision')
  }

  let res
  try {
    res = yield request(ledger, {json: true})
  } catch (e) {
    if (!res || res.statusCode !== 200) {
      log.debug('getPrecisionAndScale', e)
      throwErr()
    }
  }

  if (!res || res.statusCode !== 200) throwErr()

  log.debug('getPrecisionAndScale', res.body)
  return {
    precision: res.body.precision,
    scale: res.body.scale
  }
}

function * makeQuoteQuery (params, config) {
  // TODO: include the expiry duration in the quote logic
  let destinationExpiryDuration = parseFloat(params.destination_expiry_duration)
  let sourceExpiryDuration = parseFloat(params.source_expiry_duration)

  // Check destination_expiry_duration
  if (destinationExpiryDuration) {
    if (destinationExpiryDuration > config.getIn(['expiry', 'maxHoldTime'])) {
      throw new UnacceptableExpiryError('Destination expiry duration ' +
        'is too long, destinationExpiryDuration: ' + destinationExpiryDuration +
        ', maxHoldTime: ' + config.getIn(['expiry', 'maxHoldTime']))
    }
  } else if (sourceExpiryDuration) {
    destinationExpiryDuration = sourceExpiryDuration - config.getIn(['expiry', 'minMessageWindow'])
  } else {
    destinationExpiryDuration = config.getIn(['expiry', 'maxHoldTime'])
  }

  // Check difference between destination_expiry_duration
  // and source_expiry_duration
  if (sourceExpiryDuration) {
    if (sourceExpiryDuration - destinationExpiryDuration <
      config.getIn(['expiry', 'minMessageWindow'])) {
      throw new UnacceptableExpiryError('The difference between the ' +
        'destination expiry duration and the source expiry duration ' +
        'is insufficient to ensure that we can execute the ' +
        'source transfers')
    }
  } else {
    sourceExpiryDuration = destinationExpiryDuration + config.getIn(['expiry', 'minMessageWindow'])
  }

  let source_ledger = params.source_ledger
  if (!source_ledger) {
    if (params.source_account) source_ledger = yield getAccountLedger(params.source_account)
    else throw new InvalidURIParameterError('Missing required parameter: source_ledger or source_account')
  }

  let destination_ledger = params.destination_ledger
  if (!destination_ledger) {
    if (params.destination_account) destination_ledger = yield getAccountLedger(params.destination_account)
    else throw new InvalidURIParameterError('Missing required parameter: destination_ledger or destination_account')
  }

  return {
    destinationExpiryDuration: destinationExpiryDuration,
    sourceExpiryDuration: sourceExpiryDuration,
    source_amount: params.source_amount,
    destination_amount: params.destination_amount,
    source_ledger: source_ledger,
    destination_ledger: destination_ledger,
    source_account: params.source_account || null,
    destination_account: params.destination_account || null
  }
}

function makeQuoteArgs (query) {
  return {
    source_ledger: query.source_ledger,
    destination_ledger: query.destination_ledger,
    source_amount: query.source_amount,
    destination_amount: query.destination_amount
  }
}

function makePaymentTemplate (query, quote, ledgers) {
  const source_amount = quote.source_amount
  const destination_amount = quote.destination_amount
  const payment = {
    source_transfers: [{
      type: ledgers.getType(query.source_ledger),
      ledger: query.source_ledger,
      debits: [{
        account: query.source_account,
        amount: source_amount
      }],
      credits: [
        ledgers.makeFundTemplate(query.source_ledger, {amount: source_amount})
      ],
      expiry_duration: String(query.sourceExpiryDuration)
    }],
    destination_transfers: [{
      type: ledgers.getType(query.destination_ledger),
      ledger: query.destination_ledger,
      debits: [
        ledgers.makeFundTemplate(query.destination_ledger, {amount: destination_amount})
      ],
      credits: [{
        account: query.destination_account,
        amount: destination_amount
      }],
      expiry_duration: String(query.destinationExpiryDuration)
    }]
  }
  return payment
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

function validatePrecision (amount, precision, ledger) {
  log.debug('validatePrecision', {amount, precision, ledger})
  const bnAmount = new BigNumber(amount)

  if (bnAmount.precision() > precision) {
    throw new UnacceptableAmountError(
      `Amount (${amount}) exceeds ledger precision on ${ledger} ledger`)
  }

  if (bnAmount.lte(0)) {
    throw new UnacceptableAmountError(
      `Quoted ${ledger} is lower than minimum amount allowed`)
  }
}

function * validateBalance (query, quote) {
  const sourceBalance = yield balanceCache.get(query.source_ledger)
  const sourceAmount = new BigNumber(quote.source_amount)
  if (sourceBalance.lessThan(sourceAmount)) {
    throw new UnacceptableAmountError('Insufficient liquidity in market maker account')
  }
}

function * getQuote (params, ledgers, config) {
  const query = yield makeQuoteQuery(params, config)
  const quote = yield backend.getQuote((yield makeQuoteArgs(query)))

  const sourcePrecisionAndScale = yield getPrecisionAndScale(query.source_ledger)
  const dstPrecisionAndScale = yield getPrecisionAndScale(query.destination_ledger)

  const roundedSourceAmount = new BigNumber(quote.source_amount).toFixed(
    sourcePrecisionAndScale.scale, BigNumber.ROUND_UP)

  const roundedDestinationAmount = new BigNumber(quote.destination_amount).toFixed(
    dstPrecisionAndScale.scale, BigNumber.ROUND_DOWN)

  validatePrecision(roundedSourceAmount, sourcePrecisionAndScale.precision, 'source')
  validatePrecision(roundedDestinationAmount, dstPrecisionAndScale.precision, 'destination')

  const roundedQuote = _.assign(_.clone(quote), {
    source_amount: roundedSourceAmount,
    destination_amount: roundedDestinationAmount
  })

  yield validateBalance(query, roundedQuote)

  log.debug('' +
    roundedQuote.source_amount + ' ' +
    query.source_ledger + ' => ' +
    roundedQuote.destination_amount + ' ' +
    query.destination_ledger)

  return makePaymentTemplate(query, roundedQuote, ledgers)
}

module.exports = {
  getQuote: getQuote
}
