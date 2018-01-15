import BaseError = require('extensible-error')
import { ErrorObject } from 'ajv'

import { codes } from '../lib/ilp-errors'

export default class InvalidJsonBodyError extends BaseError {
  public ilpErrorCode: string
  protected validationErrors: ErrorObject[]

  constructor (message: string, validationErrors: ErrorObject[]) {
    super(message)

    this.ilpErrorCode = codes.F01_INVALID_PACKET
    this.validationErrors = validationErrors
  }

  debugPrint (log: (message: string) => void, validationError?: ErrorObject) {
    if (!validationError) {
      if (this.validationErrors) {
        for (let ve of this.validationErrors) {
          this.debugPrint(log, ve)
        }
      }
      return
    }

    log('-- ' + validationError.dataPath + ': ' + validationError.message)
  }
}
