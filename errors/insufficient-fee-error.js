'use strict'

const UnprocessableEntityError =
require('@ripple/five-bells-shared/errors/unprocessable-entity-error')

module.exports = function InsufficientFeeError (message) {
  Error.captureStackTrace(this, this.constructor)
  this.name = this.constructor.name
  this.message = message
}

require('util').inherits(module.exports, UnprocessableEntityError)

module.exports.prototype.handler = function *(ctx, log) {
  log.warn('Insufficient Fee: ' + this.message)
  ctx.status = 422
  ctx.body = {
    id: this.name,
    message: this.message
  }
}
