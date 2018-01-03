'use strict'

import BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

export default class LedgerNotConnectedError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    this.ilpErrorCode = codes.T01_LEDGER_UNREACHABLE
  }
}
