import { AccountInfo } from '../types/accounts'

export interface SubmitPaymentParams {
  sourceAccount: string
  destinationAccount: string
  sourceAmount: string
  destinationAmount: string
}

/** API exposed by the connector to its backends */
export interface BackendServices {
  getInfo: (accountId: string) => AccountInfo | undefined
}

export interface BackendConstructor {
  new (options: object, api: BackendServices): BackendInstance
}

export interface BackendInstance {
  connect (): Promise<void>
  getRate (sourceAccount: string, destinationAccount: string): Promise<number>
  submitPayment (params: SubmitPaymentParams): Promise<void>
}
