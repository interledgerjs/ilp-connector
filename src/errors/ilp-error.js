'use strict'

const BaseError = require('five-bells-shared').BaseError

class IlpError extends BaseError {
  constructor (packet) {
    super(packet.name)
    this.packet = packet
  }
}

module.exports = IlpError
