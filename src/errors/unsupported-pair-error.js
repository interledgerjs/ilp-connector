'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class UnsupportedPairError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('Unsupported pair: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = UnsupportedPairError
