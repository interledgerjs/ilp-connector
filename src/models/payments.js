'use strict'

const _ = require('lodash')
const BigNumber = require('bignumber.js')
const testPaymentExpiry = require('../lib/testPaymentExpiry')
const log = require('../services/log')('payments')
const executeSourceTransfers = require('../lib/executeSourceTransfers')
const UnacceptableConditionsError =
  require('../errors/unacceptable-conditions-error')
const UnacceptableRateError = require('../errors/unacceptable-rate-error')
const NoRelatedSourceCreditError =
  require('../errors/no-related-source-credit-error')
const NoRelatedDestinationDebitError =
  require('../errors/no-related-destination-debit-error')
const UnrelatedNotificationError =
  require('../errors/unrelated-notification-error')
const AssetsNotTradedError = require('../errors/assets-not-traded-error')
const hashJSON = require('five-bells-shared/utils/hashJson')
const config = require('../services/config')
const backend = require('../services/backend')
const ledgers = require('../services/ledgers')

// TODO this should handle the different types of execution_condition's.
function sourceConditionIsDestinationTransfer (source, destination) {
  // Check the message or message_hash
  const expectedMessage = {
    id: destination.id,
    state: 'executed'
  }

  if (!source.execution_condition) {
    return false
  }

  if (source.execution_condition.message_hash &&
    source.execution_condition.message_hash !== hashJSON(expectedMessage)) {
    return false
  }

  // Check the signer
  if (source.execution_condition.signer &&
    source.execution_condition.signer !== destination.ledger) {
    return false
  }

  // TODO: once we have the ledger public keys cached locally
  // validate that the public_key is the one we expect

  return true
}

function sourceConditionSameAsAllDestinationConditions (
  sourceTransfer, destination_transfers) {
  return _.every(destination_transfers,
    function (destinationTransfer) {
      return _.isEqual(sourceTransfer.execution_condition,
        destinationTransfer.execution_condition)
    })
}

function validateExecutionConditions (payment) {
  log.debug('validating execution conditions')
  // We need to have confidence that the source transfers will actually happen.
  // So each one has to depend on something we control, namely the destination
  // transfer or the condition of all of the destination transfers.
  // (So we can just copy the condition's fulfillment.)

  // Note that implementing this correctly is VERY IMPORTANT for the connector
  // to make sure they get paid back and avoid getting screwed

  // If this logic changes, make sure to change the logic in
  // validateExpiry as well

  const valid = _.every(payment.source_transfers, function (sourceTransfer) {
    const conditionIsDestTransfer =
    payment.destination_transfers.length === 1 &&
      sourceConditionIsDestinationTransfer(sourceTransfer,
        payment.destination_transfers[0])

    const conditionsAreEqual =
    sourceConditionSameAsAllDestinationConditions(
      sourceTransfer, payment.destination_transfers)

    return conditionIsDestTransfer || conditionsAreEqual
  })

  if (!valid) {
    throw new UnacceptableConditionsError("Each of the source transfers' " +
      'execution conditions must either match all of the destination ' +
      "transfers' conditions or if there is only one destination transfer " +
      "the source transfers' conditions can be the execution of the " +
      'destination transfer')
  }
}

function * validateExecutionConditionPublicKey (payment) {
  // TODO: use a cache of ledgers' public keys and move this functionality
  // into the synchronous validateExecutionConditions function
  for (const sourceTransfer of payment.source_transfers) {
    const conditionsAreEqual =
    sourceConditionSameAsAllDestinationConditions(
      sourceTransfer, payment.destination_transfers)

    if (!conditionsAreEqual) {
      // Check the public_key and algorithm
      // TODO: what do we do if the transfer hasn't been submitted
      // to the destination ledger yet?
      const destinationTransferState = yield ledgers.getState(
        payment.destination_transfers[0])

      if (sourceTransfer.execution_condition.type !==
        destinationTransferState.type) {
        throw new UnacceptableConditionsError('Source transfer execution ' +
          "condition type must match the destination ledger's.")
      }
      if (sourceTransfer.execution_condition.public_key !==
        destinationTransferState.public_key) {
        throw new UnacceptableConditionsError('Source transfer execution ' +
          "condition public key must match the destination ledger's.")
      }
    }
  }
}

function * validateExpiry (payment) {
  // TODO tie the maxHoldTime to the fx rate
  // TODO bring all these loops into one to speed this up
  const tester = yield testPaymentExpiry(config, payment)
  yield tester.validateNotExpired()
  if (tester.isAtomic()) {
    yield tester.validateMaxHoldTime()
  } else if (tester.isFinal()) {
    yield tester.validateMinExecutionWindow()
  } else {
    yield tester.validateMaxHoldTime()
    yield tester.validateMinMessageWindow()
  }
}

function amountFinder (ledger, creditOrDebit) {
  // TODO: we need a more elegant way of handling assets that we don't trade
  if (!config.getIn(['ledgerCredentials', ledger])) {
    throw new AssetsNotTradedError('This connector does not support ' +
      'the given asset pair')
  }

  const accountUri = config.getIn(['ledgerCredentials', ledger, 'account_uri'])

  return (creditOrDebit.account === accountUri
    ? new BigNumber(creditOrDebit.amount)
    : new BigNumber(0))
}

/**
 * Function to sum the credits or debits from the given array of
 * transfers and convert the amount into a single asset for
 * easier comparisons.
 *
 * @param {Array of Transfers} opts.transfers Either the source or destination transfers
 * @param {String} opts.transferSide Either 'source' or 'destination'
 * @param {String} opts.creditsOrDebits Indicates whether we want to sum the relevant credits or debits in the given transfers
 * @param {Boolean} opts.noErrors If true, don't throw errors for NoRelatedSourceCredit or DestinationDebit
 * @param {String} opts.convertToLedger The ledger representing the asset we will convert all of the amounts into (for easier comparisons)
 * @yield {Float} The total amount converted into the asset represented by opts.convertToLedger
 */
function * calculateAmountEquivalent (opts) {
  // convertedAmountTotal is going to be the total of either the credits
  // if the transfers are source_transfers or debits if the transfers
  // are destination_transfers (the amount that is either entering
  // or leaving our account)
  // Then, we are going to use the backend to convert the amount
  // into the asset represented by convertToLedger
  let convertedAmountTotal = new BigNumber(0)

  if (!opts.transfers || opts.transfers.length === 0) {
    return convertedAmountTotal
  }

  for (const transfer of opts.transfers) {
    // Total the number of credits or debits to the connectors account
    const relevantAmountTotal = _.reduce(transfer[opts.creditsOrDebits], function (result, creditOrDebit) {
      return result.plus(amountFinder(transfer.ledger, creditOrDebit))
    }, new BigNumber(0), this)

    // Throw an error if we're not included in the transfer
    if (relevantAmountTotal.lte(0) && !opts.noErrors) {
      if (opts.transferSide === 'source') {
        throw new NoRelatedSourceCreditError("Connector's account " +
          'must be credited in all source transfers to ' +
          'provide payment')
      } else if (opts.transferSide === 'destination') {
        throw new NoRelatedDestinationDebitError("Connector's account " +
          'must be debited in all destination transfers to ' +
          'provide payment')
      }
    }

    // Calculate how much the relevantAmountTotal is worth in
    // the asset represented by convertToLedger
    let quote
    if (transfer.ledger === opts.convertToLedger) {
      convertedAmountTotal = convertedAmountTotal.plus(relevantAmountTotal)
    } else if (opts.transferSide === 'source') {
      quote = yield backend.getQuote({
        source_ledger: transfer.ledger,
        destination_ledger: opts.convertToLedger,
        source_amount: relevantAmountTotal
      })
      convertedAmountTotal = convertedAmountTotal.plus(quote.destination_amount)
    } else if (opts.transferSide === 'destination') {
      quote = yield backend.getQuote({
        source_ledger: opts.convertToLedger,
        destination_ledger: transfer.ledger,
        destination_amount: relevantAmountTotal
      })
      convertedAmountTotal = convertedAmountTotal.plus(quote.source_amount)
    }
  }
  return convertedAmountTotal
}

function * validateRate (payment) {
  log.debug('validating rate')

  // Determine which ledger's asset we will convert all
  // of the others to
  let convertToLedger
  if (payment.source_transfers.length === 1) {
    convertToLedger = payment.source_transfers[0].ledger
  } else {
    convertToLedger = payment.destination_transfers[0].ledger
  }

  // Convert the source credits and destination debits to a
  // common asset so we can more easily compare them
  const sourceCreditEquivalent =
  yield calculateAmountEquivalent({
    transfers: payment.source_transfers,
    transferSide: 'source',
    creditsOrDebits: 'credits',
    convertToLedger: convertToLedger
  })
  const destinationDebitEquivalent =
  yield calculateAmountEquivalent({
    transfers: payment.destination_transfers,
    transferSide: 'destination',
    creditsOrDebits: 'debits',
    convertToLedger: convertToLedger
  })

  if (sourceCreditEquivalent.lt(destinationDebitEquivalent)) {
    throw new UnacceptableRateError('Payment rate does not match ' +
      'the rate currently offered')
  }
}

// Note this modifies the original object
function addAuthorizationToTransfers (transfers) {
  // TODO: make sure we're not authorizing anything extra
  // that shouldn't be taking money out of our account
  let credentials
  for (const transfer of transfers) {
    for (const debit of transfer.debits) {
      credentials = config.getIn(['ledgerCredentials', transfer.ledger])
      if (!credentials) {
        continue
      }

      // TODO change this when the connector's account
      // isn't the same on all ledgers
      if (debit.account === credentials.account_uri) {
        debit.authorized = true
      }
    }
  }

// TODO authorize credits
}

function * submitTransfer (destinationTransfer, sourceTransfer) {
  for (const debit of destinationTransfer.debits) {
    debit.memo = Object.assign({}, debit.memo, {
      source_transfer_ledger: sourceTransfer.ledger,
      source_transfer_id: sourceTransfer.id
    })
  }
  yield ledgers.putTransfer(destinationTransfer)
}

function * validate (payment) {
  // TODO: Check expiry settings
  // TODO: Check ledger signature on source payment
  // TODO: Check ledger signature on destination payment

  yield validateExpiry(payment)
  yield validateRate(payment)
  validateExecutionConditions(payment)
  yield validateExecutionConditionPublicKey(payment)
}

function * settle (payment) {
  log.debug('Settle payment: ' + JSON.stringify(payment))
  addAuthorizationToTransfers(payment.destination_transfers)

  const sourceTransfer = payment.source_transfers[0]
  for (const destinationTransfer of payment.destination_transfers) {
    yield submitTransfer(destinationTransfer, sourceTransfer)
  }

  const anyTransfersAreExecuted = _.some(payment.destination_transfers, (transfer) => {
    return transfer.state === 'executed'
  })

  if (anyTransfersAreExecuted) {
    yield executeSourceTransfers(payment.destination_transfers)

    // TODO: is the payment execute when the destination transfer
    // is execute or only once we've gotten paid back?
    payment.state = 'executed'
  }
}

function isTraderFunds (funds) {
  return _.some(config.ledgerCredentials, (credentials) => {
    return credentials.account_uri === funds.account
  })
}

function * updateSourceTransfer (updatedTransfer, traderCredit) {
  const destinationTransfer = traderCredit.memo && traderCredit.memo.destination_transfer
  if (!destinationTransfer) return
  ledgers.validateTransfer(destinationTransfer)

  const isTransferReady = updatedTransfer.state === 'prepared' || updatedTransfer.state === 'executed'
  if (!isTransferReady) return

  const payment = {
    source_transfers: [updatedTransfer],
    destination_transfers: [destinationTransfer]
  }
  yield validate(payment)
  yield settle(payment)
}

function * updateDestinationTransfer (updatedTransfer, traderDebit, relatedResources) {
  if (updatedTransfer.state !== 'executed') {
    log.debug('Got notification about unknown or incomplete transfer: ' + updatedTransfer.id)
    return
  }

  log.debug('Got notification about executed destination transfer')
  yield executeSourceTransfers([updatedTransfer], relatedResources)
}

function * updateTransfer (updatedTransfer, relatedResources) {
  // TODO: make sure the transfer is signed by the ledger
  // Maybe it's a source transfer:
  // When the payment's source transfer is "prepared", authorized/submit the payment.
  const traderCredit = updatedTransfer.credits.find(isTraderFunds)
  if (traderCredit) {
    yield updateSourceTransfer(updatedTransfer, traderCredit)
    return
  }

  // Or a destination transfer:
  const traderDebit = updatedTransfer.debits.find(isTraderFunds)
  if (traderDebit) {
    yield updateDestinationTransfer(updatedTransfer, traderDebit, relatedResources)
    return
  }

  // TODO: should we delete the subscription?
  throw new UnrelatedNotificationError('Notification does not match a ' +
    'payment we have a record of or the corresponding source ' +
    'transfers may already have been executed')
}

module.exports = {
  updateTransfer
}
