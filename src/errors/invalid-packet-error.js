'use strict'

const BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

class InvalidPacketError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.F01_INVALID_PACKET
  }
}

module.exports = InvalidPacketError
