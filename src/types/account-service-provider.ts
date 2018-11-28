import { AccountService } from './account-service'
import { AccountInfo } from './accounts'
import { StoreInstance } from './store'
import { Logger } from 'ilp-logger'

export interface AccountServiceProviderConstructor {
  new (options: any, services: AccountServiceProviderServices): AccountServiceProvider
}

export interface AccountServiceProviderServices {
  createLogger: (namespace: string) => {
    info: Function,
    warn: Function,
    error: Function,
    debug: Function,
    trace: Function
  },
  createStore: (namespace: string) => StoreInstance,
  accounts?: { [k: string]: AccountInfo },
}

export interface AccountServiceProviderDefinition {
  type: string
  options?: object
}

export interface AccountServiceProvider {
  startup (handler: (accountService: AccountService) => void): Promise<void>
  shutdown (): Promise<void>
}
