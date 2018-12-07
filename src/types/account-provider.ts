import reduct = require('reduct')
import Account from './account'
import { AccountProviderConfig } from '../schemas/Config'
import { loadModuleOfType } from '../lib/utils'

export type AccountProviderOptions = AccountProviderConfig['options']

export interface AccountProviderConstructor {
  new (deps: reduct.Injector, options?: AccountProviderOptions): AccountProvider
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

export function constructAccountProvider (config: AccountProviderConfig, deps: reduct.Injector): AccountProvider {
  const AccountServiceProviderConst = loadModuleOfType('account-provider', config.type) as AccountProviderConstructor
  return new AccountServiceProviderConst(deps, config.options)
}
