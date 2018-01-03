export interface SubmitPaymentParams {
  sourceAccount: string
  destinationAccount: string
  sourceAmount: string
  destinationAmount: string
}

export interface IBackend {
  connect (): Promise<void>
  getRate (sourceAccount: string, destinationAccount: string): Promise<number>
  submitPayment (params: SubmitPaymentParams): Promise<void>
}
