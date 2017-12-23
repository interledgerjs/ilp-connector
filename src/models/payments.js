'use strict'

const log = require('../common').log.create('payments')
const { createIlpRejection, codes } = require('../lib/ilp-errors')
const { isPeerProtocolPacket, processPeerProtocolRequest } = require('./peer-protocols')

async function sendOutbound (destinationAccount, destinationTransfer, accounts) {
  log.debug('sending outbound transfer. destination=' + JSON.stringify(destinationTransfer))
  return await accounts.getPlugin(destinationAccount).sendTransfer(destinationTransfer)
}

const handleIncomingTransfer = async (accounts, config, routeBuilder, backend, sourceAccount, sourceTransfer) => {
  log.debug('handling transfer. sourceAccount=' + sourceAccount)
  const address = config.address

  if (typeof sourceTransfer.ilp === 'string') {
    throw new TypeError('ILP packet provided as a string, should be a buffer. ledger=' + sourceAccount)
  } else if (!Buffer.isBuffer(sourceTransfer.ilp)) {
    throw new TypeError('ILP packet must be a buffer. ledger=' + sourceAccount)
  }

  if (isPeerProtocolPacket(sourceTransfer.ilp)) {
    return await processPeerProtocolRequest({
      sourceAccount,
      sourceTransfer,
      createIlpRejection: createIlpRejection.bind(null, address)
    })
  }
  try {
    const { destinationAccount, destinationTransfer } =
    await routeBuilder.getDestinationTransfer(sourceAccount, sourceTransfer)

    const result = await sendOutbound(destinationAccount, destinationTransfer, accounts)

    log.debug('Got notification about executed destination transfer with ID ' +
      destinationTransfer.executionCondition.slice(0, 6).toString('base64') + ' on ledger ' + destinationAccount)

    backend.submitPayment({
      sourceAccount: sourceAccount,
      sourceAmount: sourceTransfer.amount,
      destinationAccount: destinationAccount,
      destinationAmount: destinationTransfer.amount
    })

    return result
  } catch (err) {
    log.debug('transfer error.', (typeof err === 'object' && err.stack) ? err.stack : err)
    if (err.name === 'InterledgerRejectionError') {
      throw err
    }

    if (err.name === 'InvalidFieldsError' || err.name === 'DuplicateIdError') {
      throw createIlpRejection(address, {
        code: codes.F00_BAD_REQUEST,
        message: 'destination transfer failed: ' + err.message
      })
    }

    if (err.name === 'InsufficientBalanceError') {
      throw createIlpRejection(address, {
        code: codes.T04_INSUFFICIENT_LIQUIDITY,
        message: 'destination transfer failed: ' + err.message
      })
    }

    if (err.name === 'AccountNotFoundError') {
      throw createIlpRejection(address, {
        code: codes.F02_UNREACHABLE,
        message: 'destination transfer failed: ' + err.message
      })
    }

    throw createIlpRejection(address, {
      code: codes.T01_LEDGER_UNREACHABLE,
      message: 'destination transfer failed: ' + err.message
    })
  }
}

module.exports = {
  handleIncomingTransfer
}
