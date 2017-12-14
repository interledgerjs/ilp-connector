'use strict'

const BaseError = require('extensible-error')

class InterledgerRejectionError extends BaseError {
  constructor ({ message, ilpRejection }) {
    super(message)

    this.ilpRejection = ilpRejection
  }
}

module.exports = InterledgerRejectionError
