import BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

export default class InsufficientTimeoutError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    this.ilpErrorCode = codes.R02_INSUFFICIENT_TIMEOUT
  }
}
