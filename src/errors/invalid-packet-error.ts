import BaseError = require('extensible-error')

const { codes } = require('../lib/ilp-errors')

export default class InvalidPacketError extends BaseError {
  public ilpErrorCode: string

  constructor (message: string) {
    super(message)

    this.ilpErrorCode = codes.F01_INVALID_PACKET
  }
}
