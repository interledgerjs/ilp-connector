'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class NoRelatedDestinationDebitError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('No Related Destination Debit: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = NoRelatedDestinationDebitError
