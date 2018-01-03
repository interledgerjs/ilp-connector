'use strict'

import BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

export default class UnacceptableAmountError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    this.ilpErrorCode = codes.F03_INVALID_AMOUNT
  }
}
