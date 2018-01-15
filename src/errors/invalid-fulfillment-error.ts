import BaseError = require('extensible-error')

import { codes } from '../lib/ilp-errors'

export default class InvalidFulfillmentError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    // TODO: We shouldcreate a more specific error code
    this.ilpErrorCode = codes.T00_INTERNAL_ERROR
  }
}
