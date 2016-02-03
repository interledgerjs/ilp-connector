'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class ManyToManyNotSupportedError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('Many to Many Payment Not Supported: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = ManyToManyNotSupportedError
