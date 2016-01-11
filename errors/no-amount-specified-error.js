'use strict'

const BaseError = require('five-bells-shared').BaseError

class NoAmountSpecifiedError extends BaseError {

  * handler (ctx, log) {
    log.warn('No Amount Specified: ' + this.message)
    ctx.status = 400
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = NoAmountSpecifiedError
