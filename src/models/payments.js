'use strict'

const testPaymentExpiry = require('../lib/testPaymentExpiry')
const log = require('../common').log.create('payments')
const executeSourceTransfer = require('../lib/executeSourceTransfer')
const validator = require('../lib/validate')
const ilpErrors = require('../lib/ilp-errors')
const IncomingTransferError = require('../errors/incoming-transfer-error')

// Maximum number of entries in the forwarded_by field for ILP errors
const FORWARDED_BY_MAX = 6

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
    .catch((err) => {
      const rejectionMessage =
          (err.name === 'InvalidFieldsError' || err.name === 'DuplicateIdError')
        ? ilpErrors.F00_Bad_Request({message: 'destination transfer failed: ' + err.message})
        : (err.name === 'InsufficientBalanceError')
        ? ilpErrors.T04_Insufficient_Liquidity({message: 'destination transfer failed: ' + err.message})
        : (err.name === 'AccountNotFoundError')
        ? ilpErrors.F02_Unreachable({message: 'destination transfer failed: ' + err.message})
        : ilpErrors.T01_Ledger_Unreachable({message: 'destination transfer failed: ' + err.message})
      return ledgers.getPlugin(sourceTransfer.ledger)
        .rejectIncomingTransfer(sourceTransfer.id, Object.assign({
          triggered_by: ledgers.getPlugin(destinationTransfer.ledger).getAccount(),
          triggered_at: (new Date()).toISOString(),
          additional_info: {}
        }, rejectionMessage))
        .then(() => { throw err })
    })
}

function * updateIncomingTransfer (sourceTransfer, ledgers, config, routeBuilder) {
  let destinationTransfer
  try {
    destinationTransfer = yield routeBuilder.getDestinationTransfer(sourceTransfer)
    if (!destinationTransfer) return // in case the connector is the payee there is no destinationTransfer
    yield validateExpiry(sourceTransfer, destinationTransfer, config)
  } catch (err) {
    if (!(err instanceof IncomingTransferError)) throw err
    yield rejectIncomingTransfer(sourceTransfer, err.rejectionMessage, ledgers)
    return
  }
  yield settle(sourceTransfer, destinationTransfer, config, ledgers)
}

function * processExecutionFulfillment (transfer, fulfillment, ledgers, backend, config) {
  // If the destination transfer was executed, the connector should try to
  // execute the source transfer to get paid.
  if (transfer.direction === 'outgoing') {
    log.debug('Got notification about executed destination transfer with ID ' +
      transfer.id + ' on ledger ' + transfer.ledger)
    yield executeSourceTransfer(transfer, fulfillment, ledgers, backend, config)
  }
}

function * rejectIncomingTransfer (sourceTransfer, _rejectionMessage, ledgers) {
  const myAddress = ledgers.getPlugin(sourceTransfer.ledger).getAccount()
  const rejectionMessage = Object.assign({
    triggered_by: myAddress,
    triggered_at: (new Date()).toISOString(),
    additional_info: {}
  }, _rejectionMessage)
  if (sourceTransfer.executionCondition) {
    log.debug(
      'rejecting incoming transfer id=%s reason=%s',
      sourceTransfer.id,
      JSON.stringify(rejectionMessage)
    )
    yield ledgers.getPlugin(sourceTransfer.ledger)
      .rejectIncomingTransfer(sourceTransfer.id, rejectionMessage)
  } else {
    log.debug(
      'ignoring incoming optimistic transfer id=%s reason=%s',
      sourceTransfer.id,
      JSON.stringify(rejectionMessage)
    )
  }
}

function * rejectSourceTransfer (destinationTransfer, rejectionMessage, ledgers) {
  const noteToSelf = destinationTransfer.noteToSelf || {}
  const sourceTransferLedger = noteToSelf.source_transfer_ledger
  const sourceTransferId = noteToSelf.source_transfer_id
  validator.validate('IlpAddress', sourceTransferLedger)
  validator.validate('Uuid', sourceTransferId)

  // Add ourselves to the front of the forwarded list and cut off after
  // FORWARDED_BY_MAX.
  const forwardedBy = [ledgers.getPlugin(sourceTransferLedger).getAccount()]
    .concat(rejectionMessage.forwarded_by || [])
    .slice(0, FORWARDED_BY_MAX)

  yield ledgers.getPlugin(sourceTransferLedger)
    .rejectIncomingTransfer(sourceTransferId, Object.assign(rejectionMessage, {
      forwarded_by: forwardedBy
    }))
    .catch(err => {
      log.warn('Attempted to reject source transfer but it was unsucessful')
      log.debug((typeof err === 'object' && err.stack) ? err.stack : String(err))
    })
}

module.exports = {
  updateIncomingTransfer,
  processExecutionFulfillment,
  rejectIncomingTransfer,
  rejectSourceTransfer
}
