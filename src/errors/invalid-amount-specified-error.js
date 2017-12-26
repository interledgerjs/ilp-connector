
'use strict'

const BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

class InvalidAmountSpecifiedError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.F00_BAD_REQUEST
  }
}

module.exports = InvalidAmountSpecifiedError
