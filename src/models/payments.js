'use strict'

const testPaymentExpiry = require('../lib/testPaymentExpiry')
const log = require('../common').log.create('payments')
const executeSourceTransfer = require('../lib/executeSourceTransfer')
const validator = require('../lib/validate')
const startsWith = require('lodash/startsWith')
const IlpError = require('../errors/ilp-error')

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
        (err.name === 'InvalidFieldsError' || err.name === 'DuplicateIdError') ? {
          code: 'S00',
          name: 'Bad Request',
          message: 'destination transfer failed: ' + err.message
        } : {
          code: 'T01',
          name: 'Ledger Unreachable',
          message: 'destination transfer failed: ' + err.message
        }
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
  const destinationAddress = sourceTransfer.ilp.account
  const myAddress = ledgers.getPlugin(sourceTransfer.ledger).getAccount()
  if (startsWith(destinationAddress, myAddress)) {
    log.debug(
      'cannot process transfer addressed to destination which starts with my address destination=%s me=%s',
      destinationAddress,
      myAddress
    )
    yield rejectIncomingTransfer(sourceTransfer, {
      code: 'S06',
      name: 'Unexpected Payment',
      message: 'cannot process transfer addressed to destination which starts with my address'
    }, ledgers)

    return
  }

  let destinationTransfer
  try {
    destinationTransfer = yield routeBuilder.getDestinationTransfer(sourceTransfer)
    yield validateExpiry(sourceTransfer, destinationTransfer, config)
  } catch (err) {
    if (!(err instanceof IlpError)) throw err
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

  yield ledgers.getPlugin(sourceTransferLedger)
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
