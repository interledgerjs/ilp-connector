'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class UnacceptableConditionsError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('Unacceptable Conditions: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = UnacceptableConditionsError
