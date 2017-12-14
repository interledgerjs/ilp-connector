'use strict'

const testPaymentExpiry = require('../lib/testPaymentExpiry')
const log = require('../common').log.create('payments')
const validator = require('../lib/validate')
const { createIlpError, codes } = require('../lib/ilp-errors')

async function validateExpiry (sourceTransfer, destinationTransfer, config) {
  // TODO tie the maxHoldTime to the fx rate
  // TODO bring all these loops into one to speed this up
  const tester = await testPaymentExpiry(config, sourceTransfer, destinationTransfer)
  tester.validateNotExpired()
  tester.validateMaxHoldTime()
}

async function settle (destinationLedger, destinationTransfer, config, ledgers) {
  log.debug('Settle payment, destination: ' + JSON.stringify(destinationTransfer))
  return await ledgers.getPlugin(destinationLedger).sendTransfer(destinationTransfer)
}

const updateIncomingTransfer = (ledgers, config, routeBuilder, backend) => async (sourceLedger, sourceTransfer) => {
  const account = config.account

  if (typeof sourceTransfer.ilp === 'string') {
    throw new TypeError('ILP packet provided as a string, should be a buffer. ledger=' + sourceLedger)
  } else if (!Buffer.isBuffer(sourceTransfer.ilp)) {
    throw new TypeError('ILP packet must be a buffer. ledger=' + sourceLedger)
  }

  const { destinationLedger, destinationTransfer } =
    await routeBuilder.getDestinationTransfer(sourceLedger, sourceTransfer)

  // TODO ENLIGHTEN Can't have transfers with no fulfillment
  if (!destinationTransfer) return // in case the connector is the payee there is no destinationTransfer

  await validateExpiry(sourceTransfer, destinationTransfer, config)

  try {
    const result = await settle(destinationLedger, destinationTransfer, config, ledgers)

    log.debug('Got notification about executed destination transfer with ID ' +
      destinationTransfer.executionCondition.slice(0, 6).toString('base64') + ' on ledger ' + destinationLedger)

    backend.submitPayment({
      source_ledger: sourceLedger,
      source_amount: sourceTransfer.amount,
      destination_ledger: destinationLedger,
      destination_amount: destinationTransfer.amount
    })

    return result
  } catch (err) {
    log.debug('Transfer error:', (typeof err === 'object' && err.stack) ? err.stack : err)
    if (err.name === 'InterledgerRejectionError') {
      throw err
    }

    if (err.name === 'InvalidFieldsError' || err.name === 'DuplicateIdError') {
      throw createIlpError(account, {
        code: codes.F00_BAD_REQUEST,
        message: 'destination transfer failed: ' + err.message
      })
    }

    if (err.name === 'InsufficientBalanceError') {
      throw createIlpError(account, {
        code: codes.T04_INSUFFICIENT_LIQUIDITY,
        message: 'destination transfer failed: ' + err.message
      })
    }

    if (err.name === 'AccountNotFoundError') {
      throw createIlpError(account, {
        code: codes.F02_UNREACHABLE,
        message: 'destination transfer failed: ' + err.message
      })
    }

    throw createIlpError(account, {
      code: codes.T01_LEDGER_UNREACHABLE,
      message: 'destination transfer failed: ' + err.message
    })
    //   return ledgers.getPlugin(sourceTransfer.ledger)
    //     .rejectIncomingTransfer(sourceTransfer.id, Object.assign({
    //       triggered_by: ledgers.getPlugin(destinationTransfer.ledger).getAccount(),
    //       triggered_at: (new Date()).toISOString(),
    //       additional_info: {}
    //     }, rejectionMessage))
    //     .then(() => { throw err })

    // TODO ENLIGHTEN Create an InterledgerRejectionError
    //
    // await rejectIncomingTransfer(sourceLedger, sourceTransfer, err.rejectionMessage, ledgers)
    // return
  }
}

async function rejectIncomingTransfer (sourceLedger, sourceTransfer, _rejectionMessage, ledgers) {
  const rejectionMessage = Object.assign({
    // TODO: ENLIGHTEN
    // triggered_by: myAddress,
    triggered_at: (new Date()).toISOString(),
    additional_info: {}
  }, _rejectionMessage)
  log.debug(
    'rejecting incoming transfer id=%s reason=%s',
    sourceTransfer.executionCondition.slice(0, 6).toString('base64'),
    JSON.stringify(rejectionMessage)
  )
  await ledgers.getPlugin(sourceLedger)
    .rejectIncomingTransfer(sourceTransfer.id, rejectionMessage)
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
  rejectIncomingTransfer,
  rejectSourceTransfer
}
