import { AccountInfo } from '../types/accounts'
import { create as createLogger } from '../common/log'

const log = createLogger('plugin-account-service')

export class AccountServiceBase {

  protected id: string
  protected info: AccountInfo
  protected connectHandler?: () => void
  protected disconnectHandler?: () => void

  constructor (accountId: string, accountInfo: AccountInfo) {

    this.id = accountId
    this.info = accountInfo

  }

  registerConnectHandler (handler: () => void) {
    if (this.connectHandler) {
      log.error('Connect handler already exists for account: ' + this.id)
      throw new Error('Connect handler already exists for account: ' + this.id)
    }
    this.connectHandler = handler
  }

  deregisterConnectHandler () {
    if (this.connectHandler) {
      this.connectHandler = undefined
    }
  }

  registerDisconnectHandler (handler: () => void) {
    if (this.disconnectHandler) {
      log.error('Disconnect handler already exists for account: ' + this.id)
      throw new Error('Disconnect handler already exists for account: ' + this.id)
    }
    this.disconnectHandler = handler
  }

  deregisterDisconnectHandler () {
    if (this.disconnectHandler) {
      this.disconnectHandler = undefined
    }
  }

  getInfo () {
    return this.info
  }
}
