'use strict'

const BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

class UnacceptableAmountError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.F03_INVALID_AMOUNT
  }
}

module.exports = UnacceptableAmountError
