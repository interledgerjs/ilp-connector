'use strict'

const requestUtil = require('five-bells-shared/utils/request')
const log = require('../services/log')('notifications')
const model = require('../models/notifications')
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error')

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
 *         }
 *      },
 *      "signature": {
 *       "algorithm": "PS256",
 *       "publicKey": {
 *         "type": "RSA",
 *         "e": "NjU1Mzc=",
 *         "n": "Njc1NTkwOTcxMTE2NTEwMTIyODY4MzE0NjkwMzkxODI3NTAyMjQ4MzA1NzQ3NzA0NTkxNDg3MzA4MzI4MzQ3ODEzODgyNTgwMTIzMDU1NzE4OTM1MjAyMTY2Njk0OTIwODcxMDkzMzcwNjA2MDc5NTU3Mzg2ODg1MjI3MTY0MTE2NTkwMDYxNTkzMDU0NTQyMDgyMzU0Nzc5NjczMzExODExMzMwNzkwNjI0NTMxNjIxMjg2OTg0MTE3NDgwNzM3MzUwNzUwNjM4Mzg0MjYzNDMwMjczNDQ0OTIwNDgyODY5MDc2MTgzNDEwOTc1NTU2NDM4MzYxNTg4MTIyNzIxNzU0NzU2ODcwNDAyMTI3OTcxNzIxMTc2MjkxMTE2MzEwNzIxMzEyOTExMTgwNTMyNDE5ODE4NzM0NjYwNTE3MDc0MDIxNDE4Nzc3Mjc5NjcwNDkyNjc1NDA5NzU1NTk2MzUxOTAwOTAwMTA5NDMyMzAzNzg2NjExMTA3NTExNjk1NDU2MzUwNzI5NDQ5NTE4NzkxNTQ1NTAxMjkzNDcwNzExNzI3MzExNDgwMDY3Njk2MDQ3MDgwNDAwMzE5Njk2MzYxNjk3NTY0MTg2NzIxNDI3NDMwNDIyMDk3MzExNjgxNjQxNDkyNjM2Nzk1ODQxNDE5MTY5MjM1NzM1MTUzNDA2MDc1MDk1OTk3NTc2MDA4NDE3NTEyMjgzMjY5MTI3NDU1OTU4OTM3MTk5MDI1MDMxNTM4NTIyMzE5MTg5MTMyOTM3NDgyNzg2NzE3MzAxMDM0MjkyMDM2NTEzMzQ2NDU2OTE4MzcwOTk1NzQyMDM5NzAwOTkyNDM3NzY5OTM1NDQ2OTc1OTIxNDE1NjQyMTU2NzIxMzkzMTAwMjQyMDkxMTk1NTIyMjQ5ODc3NTk3NzY2MjE3NzE2MDc4MzgxNzY1MjYxMDIyNjY4NjEwNzE0NTY1MTk5ODkzODcxMTU0NDQ5NTQzMzk4NjQzNTA0Njc3NjIwNjEwOTY5ODkwNzE2MDk0MTM5NjcxOTQ1MjY2ODEzNzY1MTkyOTc4Mjc0NjcwMTk2Njc5NDM5MTM4MjgxMTk5MTc5Nzg5NjIzMzU5ODk0MTExOTEwOTAxNTYyMTg1NjE1ODcxMzQ5NjQzOTA5MjcwMDg3ODM0MzUxNTg5NTA3MjgxOTc5NzE4MzQxMzkxNzc0NjE0NzI1NzI3MjQ0ODQ0MDM0NTUyNzg2ODQxNzM3MDQ5NDc0ODU4NTY3OTAxOTY4NTcyMjcxMTY2NDk5OTgzNjI0MjkyODcwMjM5ODY0Njk4ODU0ODY3ODAyMzk5NTUxNTE3MDcyOTI0MDk1OTUzMjY4MzEzNzk4Nzg5MDEyODUzNjc4OTU5NjE1MTg1NTUxNzQwMTU0MzYxODc3OTM3NjkxMzg4MzU0MDc1Nzk0ODA4OTQxOTEwNzkxMDA3Njc2MzQzNTcyODUwNjY4NTM3MjU2NjU5MDU1Mzk2ODE5ODc0OTk0NDA2NzMzNzc0NTEwMjE0MzYyMDYxNjc0MDc4OTI2NTEzODYwOTczMjEzNTY2OTQ1MDYwNjk5MjEyNTg5Njk2Njg2NjA4NjMwODYxOTA3OTQ2NTUyNzQzNzM5OTUyMDkzNTQxMzUxNjcx"
 *       },
 *       "value": "lrtuXtNX7O1EkrG2Kc6PypOioYsZevG8QNVKTSbAw1_8gnmTBCSETf-5snTa90KKT4XLBO9KgBruo0f-xqphW4p4Y21c00OsMxTlMRWRkd-yJv7Oi0d3-MA8cixSgPg6djIR62oEPxEnnIVNv8cZ3Euq0fsRsNS4Pn6Tjmpl1jz_y-8uk_KuoAEP1QXVGnHEsp62hI2-8WjReIYz2wZMW8g7wbrCH92tSLqlj8t6Kh_9I6OMwTZgJ3W92tfuy4c-Powoo2ZQfeI3-Kj3jBbew4m-sKy1dyVOskdaIz4Rbl0enVXlBbxeeMj8KpJPMS9IToBLQXO7JzcEygywxHT72NWUgVPmJpRJ0xkSBDyu6sBx7Hg_vsid6Kn5A91dDOTribX99IstXBWEcD8uB8y_d02VlYPlkEYRPiMK9B7eIo62BkkMAQZYd2R9oelGZbVvy_Kr5zLxFhNr0wPdgc9slkSfGmHrWvB6WZp0r8ay33qEloiY_mMHBxTavLdqz2-WBH92vGGqxP3lH5LpNR1l1Cst8cABmJ82u9fpbjGZfD7DE3jKySZNL4ZSdhbjmXjlBmPfIjO_oQYce4IZKaLxm1tD7HeO5f-QY2lzzEHFxxw4783JXyyRFg0F4WOIdhysR7VJlUOMpa5LH8yBHQWlrTgq6iI6jUjhxwhhVPN3xXU"
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
  const notification = yield requestUtil.validateBody(this, 'Notification')
  log.debug('Got notification: ' + JSON.stringify(notification))
  try {
    yield model.processNotification(notification)
  } catch (e) {
    if (!(e instanceof UnacceptableExpiryError)) {
      log.error('Notification handling received critical error: ' + e)
      throw e
    } else {
      // If this receives UnacceptableExpiryError, do not respond with HTTP error 422.
      // Doing so would cause Ledger to reply with the same message, creating an infinite loop.
      // Error handling mechanism for mode.processNotifiation() should be improved in the future.
      // It should not throw an error in this situation.
      log.debug('Notification handling received non-critical error: ' + e)
    }
  }
  this.status = 200
}
