'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class NoRelatedSourceCreditError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('No Related Source Credit: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = NoRelatedSourceCreditError
