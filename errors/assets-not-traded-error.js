'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class AssetsNotTradedError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('Assets Not Traded: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = AssetsNotTradedError
