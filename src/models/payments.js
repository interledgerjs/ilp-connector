'use strict'

const testPaymentExpiry = require('../lib/testPaymentExpiry')
const log = require('../common').log.create('payments')
const executeSourceTransfer = require('../lib/executeSourceTransfer')
const validator = require('../lib/validate')
const ilpErrors = require('../lib/ilp-errors')
const IncomingTransferError = require('../errors/incoming-transfer-error')

async function validateExpiry (sourceTransfer, destinationTransfer, config) {
  // TODO tie the maxHoldTime to the fx rate
  // TODO bring all these loops into one to speed this up
  const tester = await testPaymentExpiry(config, sourceTransfer, destinationTransfer)
  tester.validateNotExpired()
  tester.validateMaxHoldTime()
}

async function settle (sourceTransfer, destinationTransfer, config, ledgers) {
  log.debug('Settle payment, source: ' + JSON.stringify(sourceTransfer))
  log.debug('Settle payment, destination: ' + JSON.stringify(destinationTransfer))
  await ledgers.getPlugin(destinationTransfer.ledger)
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

async function updateIncomingTransfer (sourceTransfer, ledgers, config, routeBuilder) {
  let destinationTransfer
  try {
    destinationTransfer = await routeBuilder.getDestinationTransfer(sourceTransfer)
    if (!destinationTransfer) return // in case the connector is the payee there is no destinationTransfer
    await validateExpiry(sourceTransfer, destinationTransfer, config)
  } catch (err) {
    if (!(err instanceof IncomingTransferError)) throw err
    await rejectIncomingTransfer(sourceTransfer, err.rejectionMessage, ledgers)
    return
  }
  await settle(sourceTransfer, destinationTransfer, config, ledgers)
}

async function processExecutionFulfillment (transfer, fulfillment, fulfillmentData, ledgers, backend, config) {
  // If the destination transfer was executed, the connector should try to
  // execute the source transfer to get paid.
  if (transfer.direction === 'outgoing') {
    log.debug('Got notification about executed destination transfer with ID ' +
      transfer.id + ' on ledger ' + transfer.ledger)
    await executeSourceTransfer(transfer, fulfillment, fulfillmentData, ledgers, backend, config)
  }
}

async function rejectIncomingTransfer (sourceTransfer, _rejectionMessage, ledgers) {
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
    await ledgers.getPlugin(sourceTransfer.ledger)
      .rejectIncomingTransfer(sourceTransfer.id, rejectionMessage)
  } else {
    log.debug(
      'ignoring incoming optimistic transfer id=%s reason=%s',
      sourceTransfer.id,
      JSON.stringify(rejectionMessage)
    )
  }
}

async function rejectSourceTransfer (destinationTransfer, rejectionMessage, ledgers) {
  const noteToSelf = destinationTransfer.noteToSelf || {}
  const sourceTransferLedger = noteToSelf.source_transfer_ledger
  const sourceTransferId = noteToSelf.source_transfer_id
  validator.validate('IlpAddress', sourceTransferLedger)
  validator.validate('Uuid', sourceTransferId)

  await ledgers.getPlugin(sourceTransferLedger)
    .rejectIncomingTransfer(sourceTransferId, Object.assign(rejectionMessage, {
      forwarded_by: ledgers.getPlugin(sourceTransferLedger).getAccount()
    }))
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
