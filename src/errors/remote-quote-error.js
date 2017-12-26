'use strict'

const BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

class RemoteQuoteError extends BaseError {
  constructor (message) {
    super(message)

    // TODO: Is this the right error code? Maybe we should pass on the error we
    //   we received where possible?
    this.ilpErrorCode = codes.T00_INTERNAL_ERROR
  }
}

module.exports = RemoteQuoteError
