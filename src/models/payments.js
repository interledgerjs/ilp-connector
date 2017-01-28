'use strict'

const testPaymentExpiry = require('../lib/testPaymentExpiry')
const log = require('../common').log.create('payments')
const executeSourceTransfer = require('../lib/executeSourceTransfer')
const validator = require('../lib/validate')
const startsWith = require('lodash/startsWith')

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

function * settle (sourceTransfer, destinationTransfer, config, ledgers) {
  log.debug('Settle payment, source: ' + JSON.stringify(sourceTransfer))
  log.debug('Settle payment, destination: ' + JSON.stringify(destinationTransfer))
  yield ledgers.getPlugin(destinationTransfer.ledger)
    .sendTransfer(destinationTransfer)
    .catch((err) =>
      ledgers.getPlugin(sourceTransfer.ledger)
        .rejectIncomingTransfer(sourceTransfer.id, 'destination transfer failed: ' + err.message)
        .then(() => { throw err }))
}

function * updateIncomingTransfer (sourceTransfer, ledgers, config, routeBuilder) {
  validateIlpHeader(sourceTransfer)

  const destinationAddress = sourceTransfer.data.ilp_header.account
  const myAddress = ledgers.getPlugin(sourceTransfer.ledger).getAccount()
  if (startsWith(destinationAddress, myAddress)) {
    log.debug(
      'cannot process transfer addressed to destination which starts with my address destination=%s me=%s',
      destinationAddress,
      myAddress
    )
    yield rejectIncomingTransfer(sourceTransfer, 'transfer addressed to me', ledgers)

    return
  }

  const destinationTransfer = yield routeBuilder.getDestinationTransfer(sourceTransfer)

  yield validateExpiry(sourceTransfer, destinationTransfer, config)
  yield settle(sourceTransfer, destinationTransfer, config, ledgers)
}

function * processExecutionFulfillment (transfer, fulfillment, ledgers, backend) {
  // If the destination transfer was executed, the connector should try to
  // execute the source transfer to get paid.
  if (transfer.direction === 'outgoing') {
    log.debug('Got notification about executed destination transfer with ID ' +
      transfer.id + ' on ledger ' + transfer.ledger)
    yield executeSourceTransfer(transfer, fulfillment, ledgers, backend)
  }
}

function * rejectIncomingTransfer (sourceTransfer, rejectionMessage, ledgers) {
  if (sourceTransfer.executionCondition) {
    log.debug(
      'rejecting incoming transfer id=%s reason=%s',
      sourceTransfer.id,
      rejectionMessage
    )
    yield ledgers.getPlugin(sourceTransfer.ledger).rejectIncomingTransfer(sourceTransfer.id, 'transfer addressed to me')
  } else {
    log.debug(
      'ignoring incoming optimistic transfer id=%s reason=%s',
      sourceTransfer.id,
      rejectionMessage
    )
  }
}

function * rejectSourceTransfer (destinationTransfer, rejectionMessage, ledgers) {
  const noteToSelf = destinationTransfer.noteToSelf || {}
  const sourceTransferLedger = noteToSelf.source_transfer_ledger
  const sourceTransferId = noteToSelf.source_transfer_id
  validator.validate('IlpAddress', sourceTransferLedger)
  validator.validate('Uuid', sourceTransferId)

  yield ledgers.getPlugin(sourceTransferLedger)
    .rejectIncomingTransfer(sourceTransferId, rejectionMessage)
    .catch(() => {
      log.warn('Attempted to reject source transfer but it was unsucessful')
    })
}

module.exports = {
  updateIncomingTransfer,
  processExecutionFulfillment,
  rejectIncomingTransfer,
  rejectSourceTransfer
}
