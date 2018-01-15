import BaseError = require('extensible-error')

import { codes } from '../lib/ilp-errors'

export default class MaxPacketAmountExceededError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    // TODO: We may want to create a more specific error code
    this.ilpErrorCode = codes.F03_INVALID_AMOUNT
  }
}
