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
      } else {
        return
      }
    }

    indent = indent || ''
    log.debug(indent + '-- ' + validationError)

    // For additionalProperties errors we want to show the name of the property
    // that violated the constraint.
    if (validationError.code === 303) {
      log.debug(indent + '   ' + validationError.dataPath)
    } else {
      log.debug(indent + '   ' + validationError.schemaPath)
    }

    if (validationError.subErrors) {
      validationError.subErrors.forEach((subError) => {
        this.debugPrint(log, subError, '  ' + indent)
      })
    }
  }
}

module.exports = InvalidJsonBodyError
