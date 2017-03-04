'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class NoRouteFoundError extends UnprocessableEntityError {

  * handler (ctx, log) {
    log.warn('No Route Found: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = NoRouteFoundError
