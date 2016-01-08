'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class InsufficientFeeError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('Insufficient Fee: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = InsufficientFeeError
