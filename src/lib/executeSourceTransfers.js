'use strict'

const ledgers = require('../services/ledgers')
const log = require('../services/log')('executeSourceTransfers')

// Add the execution_condition_fulfillment to the source transfer
// and submit it to the source ledger
function * executeSourceTransfers (sourceTransfers, destinationTransfers, relatedResources) {
  let conditionFulfillment
  if (relatedResources && relatedResources.execution_condition_fulfillment) {
    conditionFulfillment = relatedResources.execution_condition_fulfillment
  }

  // This is a feature that will likely be deprecated.
  // Right now we can use the last ledger's transfer state receipt as the execution_condition_fulfillment
  if (!conditionFulfillment) {
    const stateReceipt = yield ledgers.getState(destinationTransfers[0])
    if (stateReceipt.type && stateReceipt.signature) {
      conditionFulfillment = {
        type: stateReceipt.type,
        signature: stateReceipt.signature
      }
    } else {
      log.error('Got invalid state receipt: ' + JSON.stringify(stateReceipt))
    }
  }

  for (let sourceTransfer of sourceTransfers) {
    log.debug('Requesting fulfillment of source transfer: ' + sourceTransfer.id + ' (fulfillment: ' + JSON.stringify(conditionFulfillment) + ')')
    // TODO check the timestamp on the response from the ledger against
    // the transfer's expiry date
    // See https://github.com/interledger/five-bells-ledger/issues/149
    yield ledgers.putTransferFulfillment(sourceTransfer, conditionFulfillment)
    if (sourceTransfer.state !== 'executed') {
      log.error('Attempted to execute source transfer but it was unsucessful')
      log.debug(sourceTransfer)
    }
  }
}

module.exports = executeSourceTransfers
