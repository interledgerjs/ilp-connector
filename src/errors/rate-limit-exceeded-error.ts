import BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

export default class RateLimitExceededError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    this.ilpErrorCode = codes.T05_RATE_LIMITED
  }
}
