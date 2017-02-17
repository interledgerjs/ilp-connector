'use strict'

const BaseError = require('five-bells-shared').BaseError

class IlpError extends BaseError {
  constructor (rejectionMessage) {
    super(rejectionMessage.message)
    this.rejectionMessage = rejectionMessage
  }
}

module.exports = IlpError
