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
   * Get a rate for the given parameters.
   *
   * The one-to-one backend applies an exchange of 1, however, it will subtract
   * the spread if a spread is set in the configuration.
   *
   * @param sourceAccount The account ID of the previous party
   * @param destinationAccount The account ID of the next hop party
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
   * This method is called to allow statistics to be collected by the backend.
   *
   * The fixerio backend does not support this functionality.
   */
  submitPayment () {
    return Promise.resolve()
  }
}
