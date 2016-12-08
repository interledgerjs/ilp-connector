'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class LedgerNotConnectedError extends UnprocessableEntityError {
  * handler (ctx, log) {
    log.warn('Ledger Not Connected: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = LedgerNotConnectedError
