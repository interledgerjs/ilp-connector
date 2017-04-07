'use strict'

const log = require('../common').log.create('executeSourceTransfer')
const validator = require('./validate')
const moment = require('moment')
const _ = require('lodash')
const promiseRetry = require('promise-retry')
const retryOpts = {
  forever: true,
  factor: 2,
  minTimeout: 10
}

// Add the execution_condition_fulfillment to the source transfer
// and submit it to the source ledger
function * executeSourceTransfer (destinationTransfer, fulfillment, ledgers, backend, config) {
  if (!fulfillment) {
    log.error('Cannot execute source transfers, no condition fulfillment found. Destination transfer: ' + JSON.stringify(destinationTransfer))
    return
  }

  const noteToSelf = destinationTransfer.noteToSelf || {}
  const sourceTransferLedger = noteToSelf.source_transfer_ledger
  const sourceTransferID = noteToSelf.source_transfer_id
  const sourceTransferAmount = noteToSelf.source_transfer_amount
  validator.validate('IlpAddress', sourceTransferLedger)
  validator.validate('Uuid', sourceTransferID)
  validator.validate('Amount', sourceTransferAmount)

  log.debug('Requesting fulfillment of source transfer: ' + sourceTransferID + ' (fulfillment: ' + JSON.stringify(fulfillment) + ')')
  const plugin = ledgers.getPlugin(sourceTransferLedger)

  const sourceTransferExpiry = moment(destinationTransfer.expiresAt, moment.ISO_8601)
    .add(config.expiry.minMessageWindow, 'seconds')
  const retryTimeout = sourceTransferExpiry.diff(moment())

  const timeoutPromise = new Promise((resolve, reject) => {
    setTimeout(function () {
      reject(`Fulfillment of source transfer ${sourceTransferID} timed out.`)
    }, retryTimeout)
  })

  const fulfillPromise = promiseRetry(retryOpts, function (retry, number) {
    return Promise.resolve(plugin.fulfillCondition(sourceTransferID, fulfillment))
      .catch(function (err) {
        if (shouldRetry(err)) {
          log.debug(`Resubmitting fulfillment for source transfer ${sourceTransferID}.`)
          retry(err)
        }
      })
  })

  yield Promise.race([fulfillPromise, timeoutPromise])
    .then(function () {
      backend.submitPayment({
        source_ledger: sourceTransferLedger,
        source_amount: sourceTransferAmount,
        destination_ledger: destinationTransfer.ledger,
        destination_amount: destinationTransfer.amount
      })
    })
    .catch((err) => {
      log.error('Attempted to execute source transfer but it was unsucessful: we have not been fully repaid.' +
        ' sourceLedger=' + sourceTransferLedger + ' amount=' + sourceTransferAmount +
        ' sourceTransferID=' + sourceTransferID + ' fulfillment=' + fulfillment +
        ((err) ? `. Error was: ${err}` : ''))
    })
}

function shouldRetry (err) {
  // Refer to error types defined in the specs:
  // https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md#errors

  // returns true for UnreachableError and any other error not listed below
  return (err.name !== 'InvalidFieldsError' &&
          err.name !== 'TransferNotFound' &&
          err.name !== 'AlreadyRolledBackError' &&
          err.name !== 'TransferNotConditionalError' &&
          err.name !== 'NotAcceptedError')
}

function getRetryOptions () {
  return _.clone(retryOpts)
}

module.exports = executeSourceTransfer
module.exports.getRetryOptions = getRetryOptions
