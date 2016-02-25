'use strict'

const requestUtil = require('five-bells-shared/utils/request')
const Payments = require('../services/payments')
const log = require('../services/log')('notifications')

/* eslint-disable */
/**
 * @api {post} /notifications Receive ledger notifications
 *
 * @apiName Notifications
 * @apiGroup Notifications
 *
 * @apiParam {URI} id Subscription URI that created this notification
 * @apiParam {String} event EventId of the event that triggered the notification
 * @apiParam {Transfer} resource The resource described by the notification
 *
 * @apiDescription This is the endpoint where the connector will receive notifications
 *    from the ledgers about transfers affecting their accounts.
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
 *           "message_hash": "claZQU7qkFz7smkAVtQp9ekUCc5LgoeN9W3RItIzykNEDbGSvzeHvOk9v/vrPpm+XWx5VFjd/sVbM2SLnCpxLw==",
 *           "signer": "http://ledger.example",
 *           "type": "ed25519-sha512",
 *           "public_key": "Lvf3YtnHLMER+VHT0aaeEJF+7WQcvp4iKZAdvMVto7c="
 *         },
 *         "state": "executed"
 *       },
 *      "related_resources": {
 *         "execution_condition_fulfillment": {
 *           "type": "ed25519-sha512",
 *           "signature": "g8fxfTqO4z7ohmqYARSqKFhIgBZt6KvxD2irrSHHhES9diPCOzycOMpqHjg68+UmKPMYNQOq6Fov61IByzWhAA=="
 *         },
 *      }
 *     }'
 *   https://connector.example/notifications
 *
 * @apiSuccessExample Notification Accepted:
 *   HTTP/1.1 200 OK
 *
 * @apiUse UnrelatedNotificationError
 */
/* eslint-enable */

exports.post = function * postNotification () {
  let notification = yield requestUtil.validateBody(this, 'Notification')

  log.debug('Got notification: ' + JSON.stringify(notification))

  if (notification.event === 'transfer.update') {
    yield Payments.updateTransfer(notification.resource, notification.related_resources)
  }

  this.status = 200
}
