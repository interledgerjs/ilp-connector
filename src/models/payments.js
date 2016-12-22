'use strict'

const testPaymentExpiry = require('../lib/testPaymentExpiry')
const log = require('../common').log.create('payments')
const executeSourceTransfer = require('../lib/executeSourceTransfer')
const validator = require('../lib/validate')

function validateIlpHeader (sourceTransfer) {
  validator.validate('IlpHeader', sourceTransfer.data.ilp_header)
}

function * validateExpiry (sourceTransfer, destinationTransfer, config) {
  // TODO tie the maxHoldTime to the fx rate
  // TODO bring all these loops into one to speed this up
  const tester = yield testPaymentExpiry(config, sourceTransfer, destinationTransfer)
  tester.validateNotExpired()
  tester.validateMaxHoldTime()
}

function * settle (sourceTransfer, destinationTransfer, config, core) {
  log.debug('Settle payment, source: ' + JSON.stringify(sourceTransfer))
  log.debug('Settle payment, destination: ' + JSON.stringify(destinationTransfer))
  yield core.getPlugin(destinationTransfer.ledger)
    .sendTransfer(destinationTransfer)
    .catch((err) =>
      core.getPlugin(sourceTransfer.ledger)
        .rejectIncomingTransfer(sourceTransfer.id, 'destination transfer failed: ' + err.message)
        .then(() => { throw err }))
}

function * updateIncomingTransfer (sourceTransfer, core, config, routeBuilder) {
  validateIlpHeader(sourceTransfer)

  const destinationTransfer = yield routeBuilder.getDestinationTransfer(sourceTransfer)

  yield validateExpiry(sourceTransfer, destinationTransfer, config)
  yield settle(sourceTransfer, destinationTransfer, config, core)
}

function * processExecutionFulfillment (transfer, fulfillment, core, backend) {
  // If the destination transfer was executed, the connector should try to
  // execute the source transfer to get paid.
  if (transfer.direction === 'outgoing') {
    log.debug('Got notification about executed destination transfer with ID ' +
      transfer.id + ' on ledger ' + transfer.ledger)
    yield executeSourceTransfer(transfer, fulfillment, core, backend)
  }
}

function * rejectSourceTransfer (destinationTransfer, rejectionMessage, core) {
  const noteToSelf = destinationTransfer.noteToSelf || {}
  const sourceTransferLedger = noteToSelf.source_transfer_ledger
  const sourceTransferId = noteToSelf.source_transfer_id
  validator.validate('IlpAddress', sourceTransferLedger)
  validator.validate('Uuid', sourceTransferId)

  yield core.getPlugin(sourceTransferLedger)
    .rejectIncomingTransfer(sourceTransferId, rejectionMessage)
    .catch(() => {
      log.warn('Attempted to reject source transfer but it was unsucessful')
    })
}

module.exports = {
  updateIncomingTransfer,
  processExecutionFulfillment,
  rejectSourceTransfer
}
