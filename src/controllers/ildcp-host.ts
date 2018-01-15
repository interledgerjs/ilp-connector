'use strict'

import Accounts from '../services/accounts'
import { create as createLogger } from '../common/log'
import ILDCP = require('ilp-protocol-ildcp')
const log = createLogger('ildcp-host')
import reduct = require('reduct')

export default class IldcpHostController {
  protected accounts: Accounts

  constructor (deps: reduct.Injector) {
    this.accounts = deps(Accounts)
  }

  async handle (data: Buffer, sourceAccount: string) {
    const clientAddress = this.accounts.getChildAddress(sourceAccount)
    const info = this.accounts.getInfo(sourceAccount)
    log.debug('responding to ILDCP config request. clientAddress=%s', clientAddress)

    return ILDCP.serve({
      requestPacket: data,
      handler: () => ({
        clientAddress,
        assetScale: info.assetScale,
        assetCode: info.assetCode
      }),
      serverAddress: this.accounts.getOwnAddress()
    })
  }
}
