'use strict'

const testPaymentExpiry = require('../lib/testPaymentExpiry')
const log = require('../common').log('payments')
const executeSourceTransfer = require('../lib/executeSourceTransfer')
const routeBuilder = require('../services/route-builder')
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

function * settle (sourceTransfer, destinationTransfer, config, ledgers) {
  log.debug('Settle payment, source: ' + JSON.stringify(sourceTransfer))
  log.debug('Settle payment, destination: ' + JSON.stringify(destinationTransfer))
  yield ledgers.getLedger(destinationTransfer.ledger).send(destinationTransfer)
}

function * updateIncomingTransfer (sourceTransfer, ledgers, config) {
  validateIlpHeader(sourceTransfer)

  const destinationTransfer = yield routeBuilder.getDestinationTransfer(sourceTransfer)

  yield validateExpiry(sourceTransfer, destinationTransfer, config)
  yield settle(sourceTransfer, destinationTransfer, config, ledgers)
}

function * processExecutionFulfillment (transfer, fulfillment) {
  if (transfer.direction === 'outgoing') {
    log.debug('Got notification about executed destination transfer with ID ' +
      transfer.id + ' on ledger ' + transfer.ledger)
    yield executeSourceTransfer(transfer, fulfillment)
  }
}

function * processCancellationFulfillment (transfer, fulfillment) {
  // TODO: Forward source fulfillment to the destination
}

module.exports = {
  updateIncomingTransfer,
  processExecutionFulfillment,
  processCancellationFulfillment
}
