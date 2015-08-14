'use strict'

const _ = require('lodash')
const requestUtil = require('@ripple/five-bells-shared/utils/request')
const log = require('../services/log')('notifications')
const subscriptionRecords = require('../services/subscriptionRecords')
const executeSourceTransfers = require('../lib/executeSourceTransfers')
const UnrelatedNotificationError =
require('../errors/unrelated-notification-error')

/* eslint-disable */
/**
 * @api {post} /notifications
 *
 * @apiName Notifications
 * @apiGroup Notifications
 *
 * @apiParam {URI} id Subscription URI that created this notification
 * @apiParam {String} event EventId of the event that triggered the notification
 * @apiParam {Transfer} resource The resource described by the notification
 *
 * @apiExample {shell} Send Notification:
 *   curl -X POST -H "Content-Type: application/json" -d
 *     '{
 *       "id": "http://eur-ledger.example/EUR/subscriptions/52a42d6f-8d9c-4c05-b31c-cccc8bbdb30d",
 *       "event": "transfer.update",
 *       "resource": {
 *         "id": "http://eur-ledger.example/EUR/transfers/c92f2a2c-b21d-4e6c-96e7-4f6d6df4bee9",
 *         "ledger":"http://eur-ledger.example/EUR",
 *         "debits":[{
 *           "amount":"1.00",
 *           "account":"mark"
 *         }],
 *         "credits":[{
 *           "amount":"1.00",
 *           "account":"bob"
 *         }],
 *         "execution_condition": {
 *           "message": {
 *             "id": "http://otherledger.example/transfers/e80b0afb-f3dc-49d7-885c-fc802ddf4cc1",
 *             "state": "executed"
 *           },
 *           "signer": "http://otherledger.example",
 *           "algorithm": "ed25519-sha512",
 *           "public_key": "Z2FWS1XLz8wNpRRXcXn98tC6yIrglfI87OsmA3JTfMg="
 *         },
 *         "execution_condition_fulfillment": {
 *           "signature": "g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPCOzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=="
 *         },
 *         "state": "executed"
 *       }
 *     }'
 *   https://trader.example/notifications
 *
 * @apiSuccessExample Notification Accepted:
 *   HTTP/1.1 200 OK
 */
/* eslint-enable */

exports.post = function * postNotification () {
  let notification = yield requestUtil.validateBody(this, 'Notification')

  if (notification.event === 'transfer.update') {
    let destinationTransfer = notification.resource
    let sourceTransfers = subscriptionRecords.get(destinationTransfer.id)

    if (!sourceTransfers || sourceTransfers.length === 0) {
      // TODO: should we delete the subscription?
      throw new UnrelatedNotificationError('Notification does not match a ' +
        'settlement we have a record of or the corresponding source ' +
        'transfers may already have been executed')
    }

    if (notification.resource.state === 'executed') {
      // TODO: make sure the transfer is signed by the ledger

      log.debug('got notification about executed destination transfer')

      // This modifies the source_transfers states
      yield executeSourceTransfers(sourceTransfers, [destinationTransfer])

      let allTransfersExecuted = _.every(sourceTransfers, function (transfer) {
        return transfer.state === 'executed'
      })
      if (!allTransfersExecuted) {
        log.error('not all source transfers have been executed, ' +
          'meaning we have not been fully repaid')
      }
    } else {
      log.debug('got notification about unknown or incomplete transfer')
    }
  }

  this.status = 200
}
