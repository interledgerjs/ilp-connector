'use strict'

const BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

class InsufficientTimeoutError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.R02_INSUFFICIENT_TIMEOUT
  }
}

module.exports = InsufficientTimeoutError
