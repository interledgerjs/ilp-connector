'use strict'

import Accounts from '../services/accounts'
import { Writer } from 'oer-utils'
import { create as createLogger } from '../common/log'
const log = createLogger('ildcp-host')
import reduct = require('reduct')

export default class IldcpHostController {
  protected accounts: Accounts

  constructor (deps: reduct.Injector) {
    this.accounts = deps(Accounts)
  }

  async handle (sourceAccount: string, data: Buffer) {
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
