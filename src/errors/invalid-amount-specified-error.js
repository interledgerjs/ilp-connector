'use strict'

const BaseError = require('five-bells-shared').BaseError

class InvalidAmountSpecifiedError extends BaseError {

  * handler (ctx, log) {
    log.warn('Invalid Amount Specified: ' + this.message)
    ctx.status = 400
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = InvalidAmountSpecifiedError
