'use strict'

const log = require('../common').log.create('executeSourceTransfer')
const validator = require('./validate')

// Add the execution_condition_fulfillment to the source transfer
// and submit it to the source ledger
function * executeSourceTransfer (destinationTransfer, fulfillment, core, backend) {
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
  // TODO check the timestamp on the response from the ledger against
  // the transfer's expiry date
  // See https://github.com/interledgerjs/five-bells-ledger/issues/149
  yield core.getPlugin(sourceTransferLedger)
    .fulfillCondition(sourceTransferID, fulfillment)
    .then(() =>
      backend.submitPayment({
        source_ledger: sourceTransferLedger,
        source_amount: sourceTransferAmount,
        destination_ledger: destinationTransfer.ledger,
        destination_amount: destinationTransfer.amount
      })
    )
    .catch(() => {
      log.error('Attempted to execute source transfer but it was unsucessful: we have not been fully repaid')
    })
}

module.exports = executeSourceTransfer
