import reduct = require('reduct')
import Account from './account'

export interface AccountProviderConstructor {
  new (deps: reduct.Injector): AccountProvider
}

export interface AccountProviderDefinition {
  type: string
  options?: object
}

/**
 * Provides new accounts for the connector to track.
 */
export default interface AccountProvider {
  startup (handler: (accountService: Account) => Promise<void>): Promise<void>
  shutdown (): Promise<void>
}
