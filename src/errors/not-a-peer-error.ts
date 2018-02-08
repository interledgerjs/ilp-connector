import BaseError = require('extensible-error')

import { codes } from '../lib/ilp-errors'

export default class NotAPeerError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    this.ilpErrorCode = codes.F00_BAD_REQUEST
  }
}
