import BaseError = require('extensible-error')

import { codes } from '../lib/ilp-errors'

export default class MaxPacketAmountExceededError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    this.ilpErrorCode = codes.F08_MAXIMUM_PAYMENT_SIZE_EXCEEDED
  }
}
