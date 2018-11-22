import reduct = require('reduct')
import { AccountService } from './account-service'
import { AccountInfo } from './accounts'

export interface AccountManagerConstructor {
  new(deps: reduct.Injector): AccountManagerInstance
}

export interface AccountEntry {
  id: string,
  info: AccountInfo
}

export interface AccountManagerInstance {
  registerNewAccountHandler (handler: (accountId: string, accountService: AccountService) => Promise<void>): void,
  deregisterNewAccountHandler (): void,
  registerRemoveAccountHandler (handler: (accountId: string) => void): void,
  deregisterRemoveAccountHandler (): void,
  getAccounts (): Map<string, AccountService>
  startup (): void,
  loadIlpAddress (): Promise<string>,
  shutdown (): void
}
