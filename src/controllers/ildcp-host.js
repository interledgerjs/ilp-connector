'use strict'

const Accounts = require('../services/accounts')
const { Writer } = require('oer-utils')
const log = require('../common').log.create('ildcp-host')

class IldcpHostController {
  constructor (deps) {
    this.accounts = deps(Accounts)
  }

  async handle (sourceAccount, data) {
    log.debug('responding to ILDCP config request. clientName=' + sourceAccount)

    const info = this.accounts.getInfo(sourceAccount)

    const writer = new Writer()
    writer.writeVarOctetString(Buffer.from(sourceAccount, 'ascii'))
    writer.writeUInt8(info.currencyScale)
    writer.writeVarOctetString(Buffer.from(info.currency, 'utf8'))
    return writer.getBuffer()
  }
}

module.exports = IldcpHostController
