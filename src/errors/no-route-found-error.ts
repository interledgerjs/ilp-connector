import BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

export default class NoRouteFoundError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    this.ilpErrorCode = codes.F02_UNREACHABLE
  }
}
