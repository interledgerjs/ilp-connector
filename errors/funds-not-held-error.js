'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class FundsNotHeldError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('Funds Not Held: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = FundsNotHeldError
