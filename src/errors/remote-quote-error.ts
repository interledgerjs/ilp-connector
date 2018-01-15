import BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

export default class RemoteQuoteError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    // TODO: Is this the right error code? Maybe we should pass on the error we
    //   we received where possible?
    this.ilpErrorCode = codes.T00_INTERNAL_ERROR
  }
}
