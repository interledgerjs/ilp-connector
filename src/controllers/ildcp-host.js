'use strict'

const Accounts = require('../services/accounts')
const { Writer } = require('oer-utils')
const log = require('../common').log.create('ildcp-host')

class IldcpHostController {
  constructor (deps) {
    this.accounts = deps(Accounts)
  }

  async handle (sourceAccount, data) {
    const peerAddress = this.accounts.getChildAddress(sourceAccount)
    log.debug('responding to ILDCP config request. clientAddress=' + peerAddress)

    const info = this.accounts.getInfo(sourceAccount)

    const writer = new Writer()
    writer.writeVarOctetString(Buffer.from(peerAddress, 'ascii'))
    writer.writeUInt8(info.assetScale)
    writer.writeVarOctetString(Buffer.from(info.assetCode, 'utf8'))
    return writer.getBuffer()
  }
}

module.exports = IldcpHostController
