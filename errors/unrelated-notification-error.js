'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class UnrelatedNotificationError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('Unrelated Notification: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = UnrelatedNotificationError
