'use strict'

const BaseError = require('five-bells-shared').BaseError

class ExternalError extends BaseError {

  * handler (ctx, log) {
    log.warn('External Error: ' + this.message)
    ctx.status = 502
    ctx.body = {
      id: this.name,
      message: this.message,
      owner: this.accountIdentifier
    }
  }
}

module.exports = ExternalError
