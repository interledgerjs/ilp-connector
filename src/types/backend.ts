import Accounts from '../services/accounts'
import { AccountInfo } from '../types/accounts'
import * as IlpPacket from 'ilp-packet'

export interface SubmitPaymentParams {
  sourceAccount: string
  destinationAccount: string
  sourceAmount: string
  destinationAmount: string
  parsedPacket?: IlpPacket.IlpPrepare
  result?: Buffer
}

/** API exposed by the connector to its backends */
export interface BackendServices {
  getInfo: (accountId: string) => AccountInfo | undefined
  accounts?: Accounts
}

export interface BackendConstructor {
  new (options: object, api: BackendServices): BackendInstance
}

export interface BackendInstance {
  connect (): Promise<void>
  getRate (sourceAccount: string, destinationAccount: string): Promise<number>
  submitPayment (params: SubmitPaymentParams): Promise<void>
  submitPacket? (params: SubmitPaymentParams): Promise<void>
}
