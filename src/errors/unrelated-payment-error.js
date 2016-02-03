'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class UnrelatedPaymentError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('Unrelated Payment: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = UnrelatedPaymentError
