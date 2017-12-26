
'use strict'

const BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

class NoRouteFoundError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.F02_UNREACHABLE
  }
}

module.exports = NoRouteFoundError
