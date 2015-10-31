'use strict'

const _ = require('lodash')
const moment = require('moment')
const BigNumber = require('bignumber.js')
const log = require('../services/log')('payments')
const executeSourceTransfers = require('./executeSourceTransfers')
const ledgers = require('./ledgers')
const ExternalError = require('../errors/external-error')
const UnacceptableConditionsError =
  require('../errors/unacceptable-conditions-error')
const UnacceptableRateError = require('../errors/unacceptable-rate-error')
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')
// const InsufficientFeeError =
  // require('../errors/insufficient-fee-error')
const NoRelatedSourceCreditError =
  require('../errors/no-related-source-credit-error')
const NoRelatedDestinationDebitError =
  require('../errors/no-related-destination-debit-error')
const ManyToManyNotSupportedError =
  require('../errors/many-to-many-not-supported-error')
const UnrelatedNotificationError =
  require('../errors/unrelated-notification-error')
const AssetsNotTradedError = require('../errors/assets-not-traded-error')
const hashJSON = require('five-bells-shared/utils/hashJson')

function Payments (options) {
  this.config = options.config
  this.backend = options.backend
  this.sourceSubscriptions = options.sourceSubscriptions
  this.destinationSubscriptions = options.destinationSubscriptions
}

// TODO this should handle the different types of execution_condition's.
function sourceConditionIsDestinationTransfer (source, destination) {
  // Check the message or message_hash
  let expectedMessage = {
    id: destination.id,
    state: 'executed'
  }

  if (source.execution_condition.message_hash &&
    source.execution_condition.message_hash !== hashJSON(expectedMessage)) {
    log.debug('condition does not match the execution of the destination ' +
      'transfer, unexpected message hash')
    return false
  }

  // Check the signer
  if (source.execution_condition.signer &&
    source.execution_condition.signer !== destination.ledger) {
    log.debug('condition does not match the execution of the destination ' +
      'transfer, unexpected signer')
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

  // Note that implementing this correctly is VERY IMPORTANT for the trader
  // to make sure they get paid back and avoid getting screwed

  // If this logic changes, make sure to change the logic in
  // validateExpiry as well

  let valid = _.every(payment.source_transfers, function (sourceTransfer) {
    let conditionIsDestTransfer =
    payment.destination_transfers.length === 1 &&
      sourceConditionIsDestinationTransfer(sourceTransfer,
        payment.destination_transfers[0])

    let conditionsAreEqual =
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
  for (let sourceTransfer of payment.source_transfers) {
    let conditionsAreEqual =
    sourceConditionSameAsAllDestinationConditions(
      sourceTransfer, payment.destination_transfers)

    if (!conditionsAreEqual) {
      // Check the public_key and algorithm
      // TODO: what do we do if the transfer hasn't been submitted
      // to the destination ledger yet?
      let destinationTransferStateReq = yield ledgers.getState(
        payment.destination_transfers[0])

      // TODO: add retry logic
      // TODO: what if the response is malformed or missing fields?
      if (destinationTransferStateReq.statusCode >= 400) {
        log.error('remote error while checking destination transfer state')
        throw new ExternalError('Received an unexpected ' +
          destinationTransferStateReq.body.id +
          ' while checking destination transfer state ' +
          payment.destination_transfers[0].id)
      }

      if (sourceTransfer.execution_condition.type !==
        destinationTransferStateReq.body.type) {
        throw new UnacceptableConditionsError('Source transfer execution ' +
          "condition type must match the destination ledger's.")
      }
      if (sourceTransfer.execution_condition.public_key !==
        destinationTransferStateReq.body.public_key) {
        throw new UnacceptableConditionsError('Source transfer execution ' +
          "condition public key must match the destination ledger's.")
      }
    }
  }
}

function sourceTransferIsPrepared (transfer) {
  return transfer.state === 'prepared' ||
         transfer.state === 'executed' ||
         transfer.state === 'rejected'
}

Payments.prototype.paymentIsPrepared = function (payment) {
  let isPrepared = true
  for (let sourceTransfer of payment.source_transfers) {
    if (sourceTransferIsPrepared(sourceTransfer)) {
      this.sourceSubscriptions.remove(sourceTransfer.id)
    } else {
      this.sourceSubscriptions.put(sourceTransfer.id, payment)
      isPrepared = false
    }
  }
  return isPrepared
}

Payments.prototype.validateExpiry = function (payment) {
  // TODO use a more intelligent value for the minMessageWindow
  // TODO tie the maxHoldTime to the fx rate
  // TODO bring all these loops into one to speed this up

  // Verify none of the transfers has already expired
  function validateNotExpired (transfer) {
    if (transfer.expires_at &&
      transfer.state !== 'executed' &&
      moment(transfer.expires_at, moment.ISO_8601).isBefore(moment())) {
      throw new UnacceptableExpiryError('Transfer has already expired')
    }
  }
  _.forEach(payment.source_transfers, validateNotExpired)
  _.forEach(payment.destination_transfers, validateNotExpired)

  // Check the transfers against the minMessageWindow and maxHoldTime
  let config = this.config
  let destinationHasExecutionCondition =
  _.some(payment.destination_transfers, function (transfer) {
    return transfer.hasOwnProperty('execution_condition')
  })
  if (destinationHasExecutionCondition) {
    // If the destination transfer(s) have execution condition(s)
    // we need to make sure we're not being asked
    // to hold money for too long
    _.forEach(payment.destination_transfers, function (transfer) {
      if (!transfer.expires_at) {
        throw new UnacceptableExpiryError('Destination transfers with ' +
          'execution conditions must have an expires_at field for trader ' +
          'to agree to authorize them')
      }
      if (moment(transfer.expires_at, moment.ISO_8601).diff(moment()) >
        config.expiry.maxHoldTime * 1000) {
        throw new UnacceptableExpiryError('Destination transfer expiry is ' +
          "too far in the future. The trader's money would need to be " +
          'held for too long')
      }
    })

    // We also need to check if we have enough time between the expiry
    // of the destination transfer with the latest expiry and the expiry of
    // the source transfer with the earliest expiry is greater than the
    // minMessageWindow.
    // This is done to ensure that we have enough time after the last
    // moment one of the destination transfers could happen (taking money out
    // of our account) to execute all of the source transfers
    let earliestSourceTransferExpiry =
    _.min(_.map(payment.source_transfers, function (transfer) {
      return (transfer.expires_at && transfer.state !== 'executed'
        ? moment(transfer.expires_at, moment.ISO_8601).valueOf()
        : Math.max())
    }))

    let latestDestinationTransferExpiry =
    _.max(_.map(payment.destination_transfers, function (transfer) {
      return moment(transfer.expires_at, moment.ISO_8601).valueOf()
    }))
    if (earliestSourceTransferExpiry - latestDestinationTransferExpiry <
      config.expiry.minMessageWindow * 1000) {
      throw new UnacceptableExpiryError('The window between the latest ' +
        'destination transfer expiry and the earliest source transfer expiry ' +
        'is insufficient to ensure that we can execute the source transfers')
    }
  } else {
    // If we are the last trader we're not going to put money on hold
    // so we don't care about the maxHoldTime
    // We only care that we have enough time to execute the destination
    // transfer(s) before the source transfers expire

    // Check that we have enough time to execute the destination transfer
    // TODO use a better value for the minExecutionWindow
    let minExecutionWindow = config.expiry.minMessageWindow * 1000
    _.forEach(payment.destination_transfers, function (transfer) {
      if (transfer.expires_at &&
        moment(transfer.expires_at, moment.ISO_8601).diff(moment()) <
        minExecutionWindow) {
        throw new UnacceptableExpiryError('There is insufficient time for ' +
          'the trader to execute the destination transfer before it expires')
      }
    })

    // Check that we can execute the destination transfer and
    // have enough time to execute the source transfers before
    // they expire
    _.forEach(payment.source_transfers, function (transfer) {
      if (transfer.expires_at &&
        transfer.state !== 'executed' &&
        moment(transfer.expires_at, moment.ISO_8601).diff(moment()) <
        minExecutionWindow + config.expiry.minMessageWindow * 1000) {
        throw new UnacceptableExpiryError('There is insufficient time for ' +
          'the trader to execute the destination transfer before the source ' +
          'transfer(s) expire(s)')
      }
    })
  }
}

Payments.prototype.amountFinder = function (ledger, creditOrDebit) {
  // TODO: we need a more elegant way of handling assets that we don't trade
  if (!this.config.ledgerCredentials[ledger]) {
    throw new AssetsNotTradedError('This trader does not support ' +
      'the given asset pair')
  }

  const accountUri = this.config.ledgerCredentials[ledger].account_uri

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
Payments.prototype.calculateAmountEquivalent = function * (opts) {
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

  for (let transfer of opts.transfers) {
    // Total the number of credits or debits to the traders account
    let relevantAmountTotal = _.reduce(transfer[opts.creditsOrDebits], function (result, creditOrDebit) {
      return result.plus(this.amountFinder(transfer.ledger, creditOrDebit))
    }, new BigNumber(0), this)

    log.debug('relevantAmountTotal', relevantAmountTotal, relevantAmountTotal.constructor.name)

    // Throw an error if we're not included in the transfer
    if (relevantAmountTotal.lte(0) && !opts.noErrors) {
      if (opts.transferSide === 'source') {
        throw new NoRelatedSourceCreditError("Trader's account " +
          'must be credited in all source transfers to ' +
          'provide payment')
      } else if (opts.transferSide === 'destination') {
        throw new NoRelatedDestinationDebitError("Trader's account " +
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
      quote = yield this.backend.getQuote({
        source_ledger: transfer.ledger,
        destination_ledger: opts.convertToLedger,
        source_amount: relevantAmountTotal
      })
      convertedAmountTotal = convertedAmountTotal.plus(quote.destination_amount)
    } else if (opts.transferSide === 'destination') {
      quote = yield this.backend.getQuote({
        source_ledger: opts.convertToLedger,
        destination_ledger: transfer.ledger,
        destination_amount: relevantAmountTotal
      })
      convertedAmountTotal = convertedAmountTotal.plus(quote.source_amount)
    }
  }
  return convertedAmountTotal
}

Payments.prototype.validateRate = function * (payment) {
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
  yield this.calculateAmountEquivalent({
    transfers: payment.source_transfers,
    transferSide: 'source',
    creditsOrDebits: 'credits',
    convertToLedger: convertToLedger
  })
  const destinationDebitEquivalent =
  yield this.calculateAmountEquivalent({
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

Payments.prototype.validateFee = function * (payment) {
  // Determine which ledger's asset we will convert all
  // of the others to
  let convertToLedger
  if (payment.source_transfers.length === 1) {
    convertToLedger = payment.source_transfers[0].ledger
  } else {
    convertToLedger = payment.destination_transfers[0].ledger
  }

  // TODO: make sure the source_fee_transfers have been executed
  const sourceFeesEquivalent =
  yield this.calculateAmountEquivalent({
    transfers: payment.source_fee_transfers,
    transferSide: 'source',
    creditsOrDebits: 'credits',
    convertToLedger: convertToLedger,
    noErrors: true
  })

  if (sourceFeesEquivalent.eq(0)) {
    // throw new InsufficientFeeError('Source fee transfer ' +
    //   'must be paid to account for cost of holding funds')
  }

  // Calculate cost of held funds
  const destinationDebitEquivalent =
  yield this.calculateAmountEquivalent({
    transfers: payment.destination_transfers,
    transferSide: 'destination',
    creditsOrDebits: 'debits',
    convertToLedger: convertToLedger,
    noErrors: true
  })
  const costOfHeldFunds = new BigNumber(this.config.expiry.feePercentage)
    .div(100).times(destinationDebitEquivalent)

  // Calculate how much we're supposed to pay out in fees
  const destinationFeesEquivalent =
  yield this.calculateAmountEquivalent({
    transfers: payment.destination_fee_transfers,
    transferSide: 'destination',
    creditsOrDebits: 'debits',
    convertToLedger: convertToLedger,
    noErrors: true
  })

  const totalCost = costOfHeldFunds.plus(destinationFeesEquivalent)

  if (sourceFeesEquivalent.lt(totalCost)) {
    // throw new InsufficientFeeError('Source fees are ' +
    //   'insufficient to cover the cost of holding funds ' +
    //   'and paying the fees for the destination transfers')
  }
}

function validateOneToManyOrManyToOne (payment) {
  if (payment.source_transfers.length > 1 &&
    payment.destination_transfers.length > 1) {
    throw new ManyToManyNotSupportedError('This trader does not support ' +
      'payments that include multiple source transfers and multiple ' +
      'destination transfers')
  }
}

// Note this modifies the original object
Payments.prototype.addAuthorizationToTransfers = function (transfers) {
  // TODO: make sure we're not authorizing anything extra
  // that shouldn't be taking money out of our account
  let credentials
  for (let transfer of transfers) {
    for (let debit of transfer.debits) {
      credentials = this.config.ledgerCredentials[transfer.ledger]
      if (!credentials) {
        continue
      }

      // TODO change this when the trader's account
      // isn't the same on all ledgers
      if (debit.account === credentials.account_uri) {
        debit.authorized = true
      }
    }
  }

// TODO authorize credits
}

Payments.prototype.submitTransfers = function * (transfers, correspondingSourceTransfers) {
  for (let transfer of transfers) {
    yield ledgers.putTransfer(transfer)
    let newState = transfer.state
    if (newState !== 'executed' && correspondingSourceTransfers) {
      // Store this subscription so when we get the notification
      // we know what source transfer to go and unlock
      log.debug('destination transfer not yet executed, ' +
        'added subscription record')
      this.destinationSubscriptions.put(transfer.id,
        correspondingSourceTransfers)
    }
  }
}

Payments.prototype.validate = function * (payment) {
  // TODO: Check expiry settings
  // TODO: Check ledger signature on source payment
  // TODO: Check ledger signature on destination payment

  log.debug('validating payment ID: ' + payment.id)

  // Note that some traders may facilitate many to many
  // payments but this one will throw an error
  validateOneToManyOrManyToOne(payment)

  this.validateExpiry(payment)
  yield this.validateRate(payment)
  yield this.validateFee(payment)
  validateExecutionConditions(payment)
  yield validateExecutionConditionPublicKey(payment)

  return this.paymentIsPrepared(payment)
}

Payments.prototype.settle = function * (payment) {
  if (payment.destination_fee_transfers) {
    log.debug('submitting destination fee transfers')
    this.addAuthorizationToTransfers(payment.destination_fee_transfers)
    yield this.submitTransfers(payment.destination_fee_transfers)
  }

  log.debug('submitting destination transfers')
  this.addAuthorizationToTransfers(payment.destination_transfers)
  yield this.submitTransfers(payment.destination_transfers,
    payment.source_transfers)

  const anyTransfersAreExecuted = _.some(payment.destination_transfers, (transfer) => {
    return transfer.state === 'executed'
  })

  if (anyTransfersAreExecuted) {
    yield executeSourceTransfers(payment.source_transfers,
      payment.destination_transfers)

    // TODO: is the payment execute when the destination transfer
    // is execute or only once we've gotten paid back?
    payment.state = 'executed'
  }
}

Payments.prototype.updateTransfer = function * (updatedTransfer) {
  // Maybe its a source transfer:
  let payment = this.sourceSubscriptions.get(updatedTransfer.id)
  if (payment) {
    yield this.updateSourceTransfer(updatedTransfer, payment)
    return
  }

  // Or a destination transfer:
  let sourceTransfers = this.destinationSubscriptions.get(updatedTransfer.id)
  if (sourceTransfers && sourceTransfers.length) {
    yield this.updateDestinationTransfer(updatedTransfer, sourceTransfers)
    return
  }

  // TODO: should we delete the subscription?
  throw new UnrelatedNotificationError('Notification does not match a ' +
    'payment we have a record of or the corresponding source ' +
    'transfers may already have been executed')
}

// A notification about `updatedTransfer` (which is a source transfer) arrived,
// so update the state on the corresponding transfer within the cached
// payment. When all of the payment's source transfers are "prepared",
// authorized/submit the payment.
Payments.prototype.updateSourceTransfer = function * (updatedTransfer, payment) {
  let target_id = updatedTransfer.id
  let source_transfers = payment.source_transfers
  for (var i = 0; i < source_transfers.length; i++) {
    if (source_transfers[i].id === target_id) {
      source_transfers[i] = updatedTransfer
      log.debug('updateSourceTransfer', target_id)
      break
    }
  }

  if (updatedTransfer.state === 'prepared') {
    this.sourceSubscriptions.remove(target_id)
    if (!this.sourceSubscriptions.hasPayment(payment)) {
      yield this.settle(payment)
    }
  }
}

Payments.prototype.updateDestinationTransfer = function * (updatedTransfer, sourceTransfers) {
  if (updatedTransfer.state !== 'executed') {
    log.debug('got notification about unknown or incomplete transfer')
    return
  }

  // TODO: make sure the transfer is signed by the ledger
  log.debug('got notification about executed destination transfer')

  // This modifies the source_transfers states
  yield executeSourceTransfers(sourceTransfers, [updatedTransfer])
  let allTransfersExecuted = _.every(sourceTransfers, function (transfer) {
    return transfer.state === 'executed'
  })
  if (!allTransfersExecuted) {
    log.error('not all source transfers have been executed, ' +
      'meaning we have not been fully repaid')
  }
}

module.exports = Payments
