
'use strict'

import BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

export default class InvalidAmountSpecifiedError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    this.ilpErrorCode = codes.F00_BAD_REQUEST
  }
}
