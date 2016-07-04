'use strict'

const log = require('../common').log('executeSourceTransfer')
const validator = require('./validate')

// Add the execution_condition_fulfillment to the source transfer
// and submit it to the source ledger
function * executeSourceTransfer (destinationTransfer, fulfillment, ledgers) {
  if (!fulfillment) {
    log.error('Cannot execute source transfers, no condition fulfillment found. Destination transfer: ' + JSON.stringify(destinationTransfer))
    return
  }

  const noteToSelf = destinationTransfer.noteToSelf || {}
  const sourceTransferLedger = noteToSelf.source_transfer_ledger
  const sourceTransferID = noteToSelf.source_transfer_id
  validator.validate('Iri', sourceTransferLedger)
  validator.validate('Uuid', sourceTransferID)

  log.debug('Requesting fulfillment of source transfer: ' + sourceTransferID + ' (fulfillment: ' + JSON.stringify(fulfillment) + ')')
  // TODO check the timestamp on the response from the ledger against
  // the transfer's expiry date
  // See https://github.com/interledger/five-bells-ledger/issues/149
  const sourceTransferState = yield ledgers.getLedger(sourceTransferLedger)
    .fulfillCondition(sourceTransferID, fulfillment)
  if (sourceTransferState !== 'executed') {
    log.error('Attempted to execute source transfer but it was unsucessful: we have not been fully repaid')
  }
}

module.exports = executeSourceTransfer
