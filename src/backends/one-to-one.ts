import BigNumber from 'bignumber.js'
import { AccountInfo } from '../types/accounts'
import { IBackend } from '../types/backend'

export interface OneToOneOptions {
  spread: number,
  ratesApiUrl: string,
  getInfo: (accountId: string) => AccountInfo,
  getAssetCode: (accountId: string) => string
}

/**
 * Backend which charges no spread and trades everything one-to-one.
 */
export default class OneToOneBackend implements IBackend {
  protected spread: number
  protected getInfo: (accountId: string) => AccountInfo
  protected getAssetCode: (accountId: string) => string

  /**
   * Constructor.
   *
   * @param {Integer} opts.spread The spread we will use to mark up the FX rates
   */
  constructor (opts: OneToOneOptions) {
    this.spread = opts.spread || 0
    this.getInfo = opts.getInfo
  }

  /**
   * Nothing to do since this backend is totally static.
   */
  async connect () {
    // Nothing to do
  }

  /**
   * Get a liquidity curve for the given parameters.
   *
   * @param {String} params.sourceAccount The URI of the source ledger
   * @param {String} params.destinationAccount The URI of the destination ledger
   * @param {String} params.sourceCurrency The source currency
   * @param {String} params.destinationCurrency The destination currency
   * @returns {Promise.<Object>}
   */
  async getRate (sourceAccount: string, destinationAccount: string) {
    const sourceInfo = this.getInfo(sourceAccount)
    const destinationInfo = this.getInfo(destinationAccount)

    const scaleDiff = destinationInfo.assetScale - sourceInfo.assetScale
    // The spread is subtracted from the rate when going in either direction,
    // so that the DestinationAmount always ends up being slightly less than
    // the (equivalent) SourceAmount -- regardless of which of the 2 is fixed:
    //
    //   SourceAmount * (1 - Spread) = DestinationAmount
    //
    const rate = new BigNumber(1).minus(this.spread).shift(scaleDiff).toPrecision(15)

    return Number(rate)
  }

  /**
   * Dummy function because we're not actually going
   * to submit the payment to any real backend, we're
   * just going to execute it on the accounts we're connected to
   *
   * @param {String} params.sourceAccount The URI of the source ledger
   * @param {String} params.destinationAccount The URI of the destination ledger
   * @param {String} params.sourceAmount The amount of the source asset we want to send
   * @param {String} params.destinationAmount The amount of the destination asset we want to send
   * @return {Promise.<null>}
   */
  submitPayment () {
    return Promise.resolve()
  }
}
