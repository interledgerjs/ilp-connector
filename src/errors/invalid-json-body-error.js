'use strict'

const BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

class InvalidJsonBodyError extends BaseError {
  constructor (message, validationErrors) {
    super(message)

    this.ilpErrorCode = codes.F01_INVALID_PACKET
    this.validationErrors = validationErrors
  }

  debugPrint (log, validationError, indent) {
    if (!validationError) {
      if (this.validationErrors) {
        for (let ve of this.validationErrors) {
          this.debugPrint(log, ve)
        }
      }
      return
    }

    indent = indent || ''
    log(indent + '-- ' + validationError.dataPath + ': ' + validationError.message)
  }
}

module.exports = InvalidJsonBodyError
