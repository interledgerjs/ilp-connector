'use strict'

const _ = require('lodash')
const testPaymentExpiry = require('../lib/testPaymentExpiry')
const log = require('../common').log('payments')
const executeSourceTransfers = require('../lib/executeSourceTransfers')
const UnrelatedNotificationError =
  require('../errors/unrelated-notification-error')
const AssetsNotTradedError = require('../errors/assets-not-traded-error')
const routeBuilder = require('../services/route-builder')

function * validateExpiry (sourceTransfer, destinationTransfer, config) {
  // TODO tie the maxHoldTime to the fx rate
  // TODO bring all these loops into one to speed this up
  const tester = yield testPaymentExpiry(config, sourceTransfer, destinationTransfer)
  tester.validateNotExpired()
  if (tester.isAtomic()) {
    tester.validateMaxHoldTime()
  } else {
    tester.validateMaxHoldTime()
    tester.validateMinMessageWindow()
  }
}

function * validate (sourceTransfer, destinationTransfer, config) {
  yield validateExpiry(sourceTransfer, destinationTransfer, config)
}

function * settle (sourceTransfer, destinationTransfer, config, ledgers) {
  log.debug('Settle payment, source: ' + JSON.stringify(sourceTransfer))
  log.debug('Settle payment, destination: ' + JSON.stringify(destinationTransfer))

  yield ledgers.getLedger(destinationTransfer.ledger).send(destinationTransfer)
}

function isTraderFunds (config, funds) {
  return _.some(config.ledgerCredentials, (credentials) => {
    return credentials.account_uri === funds.account
  })
}

function * updateSourceTransfer (updatedTransfer, traderCredit, ledgers, config) {
  const isTransferReady = updatedTransfer.state === 'prepared' ||
    (updatedTransfer.state === 'executed' && !updatedTransfer.execution_condition)
  if (!isTransferReady) return

  if (!config.ledgerCredentials[updatedTransfer.ledger]) {
    throw new AssetsNotTradedError('This connector does not support the given asset pair')
  }

  // TODO this is cheating, but how do we know the type of the final transfer's ledger?
  ledgers.getLedger(updatedTransfer.ledger)
    .validateTransfer(traderCredit.memo.destination_transfer)
  const destinationTransfer = traderCredit.memo.destination_transfer =
    yield routeBuilder.getDestinationTransfer(updatedTransfer)

  yield validate(updatedTransfer, destinationTransfer, config)
  yield settle(updatedTransfer, destinationTransfer, config, ledgers)
}

function * updateDestinationTransfer (updatedTransfer, traderDebit, relatedResources) {
  if (updatedTransfer.state !== 'executed') {
    log.debug('Got notification about unknown or incomplete transfer: ' + updatedTransfer.id)
    return
  }

  log.debug('Got notification about executed destination transfer')
  yield executeSourceTransfers([updatedTransfer], relatedResources)
}

function * updateTransfer (updatedTransfer, relatedResources, ledgers, config) {
  // Maybe it's a destination transfer:
  const traderDebit = updatedTransfer.debits.find(_.partial(isTraderFunds, config))
  if (traderDebit) {
    yield updateDestinationTransfer(updatedTransfer, traderDebit, relatedResources)
  }

  // Or a source transfer:
  // When the payment's source transfer is "prepared", authorized/submit the payment.
  const traderCredit = updatedTransfer.credits.find(_.partial(isTraderFunds, config))
  if (traderCredit) {
    yield updateSourceTransfer(updatedTransfer, traderCredit, ledgers, config)
    return
  }

  // TODO: should we delete the subscription?
  throw new UnrelatedNotificationError('Notification does not match a ' +
    'payment we have a record of or the corresponding source ' +
    'transfers may already have been executed')
}

module.exports = {
  updateTransfer
}
