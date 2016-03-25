'use strict'

const _ = require('lodash')
const ledgers = require('../services/ledgers')
const log = require('../common').log('executeSourceTransfers')
const validate = require('./validate')

function * getConditionFulfillment (destinationTransfers, relatedResources) {
  // There are 3 possible places we can get the fulfillment from:
  // 1) If this function was triggered by an incoming notification of an executed
  // payment it should include the fulfillment and that will be passed in as relatedResources
  if (relatedResources && relatedResources.execution_condition_fulfillment) {
    return relatedResources.execution_condition_fulfillment
  }

  // 2) If any of the destination transfers were executed as soon as we authorized
  // them (e.g. if the fulfillment was somehow already there) or if the notification
  // didn't come with the fulfillment for any reason we should request the fulfillment from the ledgers
  const executedTransfers = _.filter(destinationTransfers, function (transfer) {
    return transfer.state === 'executed' && transfer.execution_condition
  })
  let fulfillment
  for (let transfer of executedTransfers) {
    const transferFulfillment = yield ledgers.getTransferFulfillment(transfer)
    // TODO do we need to check if this fulfills the specific source transfers we're
    // interested in or should we assume that we'll ensure all the conditions are the
    // same when we agree to facilitate a payment?
    if (transferFulfillment) {
      fulfillment = transferFulfillment
      break
    }
  }
  if (fulfillment) {
    return fulfillment
  }

  // 3) Right now we can use the last ledger's transfer state receipt as the execution_condition_fulfillment
  // Note that this is a feature that will likely be deprecated
  if (destinationTransfers.length === 1) {
    const stateReceipt = yield ledgers.getState(destinationTransfers[0])
    if (stateReceipt.type && stateReceipt.signature) {
      return {
        type: stateReceipt.type,
        signature: stateReceipt.signature
      }
    } else {
      log.error('Got invalid state receipt: ' + JSON.stringify(stateReceipt))
    }
  }
}

// Add the execution_condition_fulfillment to the source transfer
// and submit it to the source ledger
function * executeSourceTransfers (destinationTransfers, relatedResources) {
  const conditionFulfillment = yield getConditionFulfillment(destinationTransfers, relatedResources)

  if (!conditionFulfillment) {
    log.error('Cannot execute source transfers, no condition fulfillment found. Destination transfers: ' + JSON.stringify(destinationTransfers))
    return
  }

  for (let destinationTransfer of destinationTransfers) {
    const destinationDebitMemo = destinationTransfer.debits[0].memo || {}
    const sourceTransferLedger = destinationDebitMemo.source_transfer_ledger
    const sourceTransferID = destinationDebitMemo.source_transfer_id
    validate('Iri', sourceTransferLedger)
    validate('Iri', sourceTransferID)

    log.debug('Requesting fulfillment of source transfer: ' + sourceTransferID + ' (fulfillment: ' + JSON.stringify(conditionFulfillment) + ')')
    // TODO check the timestamp on the response from the ledger against
    // the transfer's expiry date
    // See https://github.com/interledger/five-bells-ledger/issues/149
    const sourceTransferState = yield ledgers.putTransferFulfillment(sourceTransferLedger, sourceTransferID, conditionFulfillment)
    if (sourceTransferState !== 'executed') {
      log.error('Attempted to execute source transfer but it was unsucessful: we have not been fully repaid')
    }
  }
}

module.exports = executeSourceTransfers
