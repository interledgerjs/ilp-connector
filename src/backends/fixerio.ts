import fetchUri from 'node-fetch'
import BigNumber from 'bignumber.js'
import { AccountInfo } from '../types/accounts'
import { BackendInstance, BackendServices } from '../types/backend'

import { create as createLogger } from '../common/log'
const log = createLogger('fixerio')

const RATES_API = 'https://api.fixer.io/latest'

export interface FixerIoOptions {
  spread: number,
  ratesApiUrl: string,
  mockData: object
}

/**
 * Dummy backend that uses Fixer.io API for FX rates
 */
export default class FixerIoBackend implements BackendInstance {
  protected spread: number
  protected ratesApiUrl: string
  protected getInfo: (accountId: string) => AccountInfo | undefined

  protected rates: {
    [key: string]: number
  }
  protected currencies: string[]
  private mockData: object

  /**
   * Constructor.
   *
   * @param opts.spread The spread we will use to mark up the FX rates
   * @param opts.ratesApiUrl The URL for querying Fixer.io
   * @param api.getInfo Method which maps account IDs to AccountInfo objects
   * @param api.getAssetCode Method which maps account IDs to asset code
   */
  constructor (opts: FixerIoOptions, api: BackendServices) {
    this.spread = opts.spread || 0
    this.ratesApiUrl = opts.ratesApiUrl || RATES_API
    this.mockData = opts.mockData
    this.getInfo = api.getInfo
    // this.ratesCacheTtl = opts.ratesCacheTtl || 24 * 3600000

    this.rates = {}
    this.currencies = []
  }

  /**
   * Get the rates from the API
   *
   * Mock data can be provided for testing purposes
   */
  async connect () {
    let apiData
    if (this.mockData) {
      log.debug('connect using mock data.')
      apiData = this.mockData
    } else {
      log.debug('connect. uri=' + this.ratesApiUrl)
      let result = await fetchUri(this.ratesApiUrl)
      apiData = await result.json()
    }
    this.rates = apiData.rates
    this.rates[apiData.base] = 1
    this.currencies = Object.keys(this.rates)
    this.currencies.sort()
    log.debug('data loaded. noCurrencies=' + this.currencies.length)
  }

  _formatAmount (amount: string) {
    return new BigNumber(amount).toFixed(2)
  }

  _formatAmountCeil (amount: string) {
    return new BigNumber(amount).decimalPlaces(2, BigNumber.ROUND_CEIL).toFixed(2)
  }

  /**
   * Get a rate for the given parameters.
   *
   * @param sourceAccount The account ID of the source account
   * @param destinationAccount The account ID of the next hop account
   * @returns Exchange rate with spread applied
   */
  async getRate (sourceAccount: string, destinationAccount: string) {
    const sourceInfo = this.getInfo(sourceAccount)
    const destinationInfo = this.getInfo(destinationAccount)

    if (!sourceInfo) {
      log.warn('unable to fetch account info for source account. accountId=%s', sourceAccount)
      throw new Error('unable to fetch account info for source account. accountId=' + sourceAccount)
    }
    if (!destinationInfo) {
      log.warn('unable to fetch account info for destination account. accountId=%s', destinationAccount)
      throw new Error('unable to fetch account info for destination account. accountId=' + destinationAccount)
    }

    const sourceCurrency = sourceInfo.assetCode
    const destinationCurrency = destinationInfo.assetCode

    // Get ratio between currencies and apply spread
    const sourceRate = this.rates[sourceCurrency]
    const destinationRate = this.rates[destinationCurrency]

    if (!sourceRate) {
      log.warn('no rate available for source currency. currency=%s', sourceCurrency)
      throw new Error('no rate available. currency=' + sourceCurrency)
    }

    if (!destinationRate) {
      log.warn('no rate available for destination currency. currency=%s', destinationCurrency)
      throw new Error('no rate available. currency=' + destinationCurrency)
    }

    // The spread is subtracted from the rate when going in either direction,
    // so that the DestinationAmount always ends up being slightly less than
    // the (equivalent) SourceAmount -- regardless of which of the 2 is fixed:
    //
    //   SourceAmount * Rate * (1 - Spread) = DestinationAmount
    //
    const rate = new BigNumber(destinationRate).shiftedBy(destinationInfo.assetScale)
      .div(new BigNumber(sourceRate).shiftedBy(sourceInfo.assetScale))
      .times(new BigNumber(1).minus(this.spread))
      .toPrecision(15)

    log.debug('quoted rate. from=%s to=%s fromCur=%s toCur=%s rate=%s spread=%s', sourceAccount, destinationAccount, sourceCurrency, destinationCurrency, rate, this.spread)

    return Number(rate)
  }

  /**
   * This method is called to allow statistics to be collected by the backend.
   *
   * The fixerio backend does not support this functionality.
   */
  async submitPayment () {
    return Promise.resolve(undefined)
  }
}
