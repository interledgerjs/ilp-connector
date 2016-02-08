'use strict'

const _ = require('lodash')
const ledgers = require('../services/ledgers')
const log = require('../services/log')('executeSourceTransfers')
const ExternalError = require('../errors/external-error')

function * addConditionFulfillments (source_transfers, destination_transfers) {
  for (let sourceTransfer of source_transfers) {
    // Check if the source transfer's execution_condition is
    // the execution of the destination transfer
    let conditionsAreEqual = _.every(destination_transfers,
      function (destinationTransfer) {
        return _.isEqual(sourceTransfer.execution_condition,
          destinationTransfer.execution_condition)
      })

    if (conditionsAreEqual) {
      let transferWithConditionFulfillment = _.find(destination_transfers, (transfer) => {
        return transfer.execution_condition_fulfillment
      })

      if (transferWithConditionFulfillment) {
        sourceTransfer.execution_condition_fulfillment =
          transferWithConditionFulfillment.execution_condition_fulfillment
      } else {
        log.warn('attempting to add execution_condition_fulfillment to source transfers ' +
          'but none of the destination transfers have execution_condition_fulfillments')
      }
    } else {
      // we know there is only one destination transfer

      log.debug('checking destination transfer state')

      let destinationTransferStateReq = yield ledgers.getState(
        destination_transfers[0])

      // TODO: add retry logic
      if (destinationTransferStateReq.statusCode >= 400) {
        log.error('remote error while checking destination transfer state')
        throw new ExternalError('Received an unexpected ' +
          destinationTransferStateReq.body.id +
          ' while checking destination transfer state ' +
          destination_transfers[0].id)
      }

      // TODO: validate that this actually comes back in the right format

      if (destinationTransferStateReq.body.message &&
        destinationTransferStateReq.body.message.state !== 'executed') {
        log.warn('destination transfer not yet executed')
      } else {
        sourceTransfer.execution_condition_fulfillment = {
          type: destinationTransferStateReq.body.type,
          signature: destinationTransferStateReq.body.signature
        }
      }
    }
  }
}

// Add the execution_condition_fulfillment to the source transfer
// and submit it to the source ledger
function * executeSourceTransfers (source_transfers, destination_transfers) {
  yield addConditionFulfillments(source_transfers, destination_transfers)

  for (let sourceTransfer of source_transfers) {
    log.debug('requesting fulfillment of source transfer')
    const transferFulfillment = sourceTransfer.execution_condition_fulfillment
    if (transferFulfillment) {
      yield ledgers.putTransferFulfillment(sourceTransfer, transferFulfillment)
    }

    if (sourceTransfer.state !== 'executed') {
      log.error('Attempted to execute source transfer but it was unsucessful')
      log.debug(sourceTransfer)
    }
  }
}

module.exports = executeSourceTransfers
