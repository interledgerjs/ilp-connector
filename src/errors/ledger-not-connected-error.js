'use strict'

const BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

class LedgerNotConnectedError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.T01_LEDGER_UNREACHABLE
  }
}

module.exports = LedgerNotConnectedError
