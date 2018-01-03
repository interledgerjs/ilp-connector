import fetchUri from 'node-fetch'
import BigNumber from 'bignumber.js'
import { AccountInfo } from '../types/accounts'
import { IBackend } from '../types/backend'

import { create as createLogger } from '../common/log'
const log = createLogger('fixerio')

const RATES_API = 'https://api.fixer.io/latest'

export interface FixerIoOptions {
  spread: number,
  ratesApiUrl: string,
  getInfo: (accountId: string) => AccountInfo,
  getAssetCode: (accountId: string) => string
}

/**
 * Dummy backend that uses Fixer.io API for FX rates
 */
export default class FixerIoBackend implements IBackend {
  protected spread: number
  protected getInfo: (accountId: string) => AccountInfo
  protected getAssetCode: (accountId: string) => string

  protected rates: {
    [key: string]: number
  }
  protected currencies: string[]

  /**
   * Constructor.
   *
   * @param {Integer} opts.spread The spread we will use to mark up the FX rates
   * @param {String} opts.ratesApiUrl The API endpoint we will request rates from
   */
  constructor (opts: FixerIoOptions) {
    this.spread = opts.spread || 0
    this.getInfo = opts.getInfo
    this.getAssetCode = opts.getAssetCode
    // this.ratesCacheTtl = opts.ratesCacheTtl || 24 * 3600000

    this.rates = {}
    this.currencies = []
  }

  /**
   * Get the rates from the API
   *
   * Mock data can be provided for testing purposes
   */
  async connect (mockData?: Object) {
    let apiData
    if (mockData) {
      log.debug('connect using mock data.')
      apiData = mockData
    } else {
      log.debug('connect. uri=' + RATES_API)
      let result = await fetchUri(RATES_API)
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
    return new BigNumber(amount).times(100).ceil().div(100).toFixed(2)
  }

  /**
   * Get a liquidity curve for the given parameters.
   *
   * @param {String} sourceAccount The account ID of the source account
   * @param {String} destinationAccount The account ID of the next hop account
   * @returns {Promise.<Object>}
   */
  async getRate (sourceAccount: string, destinationAccount: string) {
    const sourceCurrency = this.getAssetCode(sourceAccount)
    const destinationCurrency = this.getAssetCode(destinationAccount)
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

    const sourceInfo = this.getInfo(sourceAccount)
    const destinationInfo = this.getInfo(destinationAccount)

    // The spread is subtracted from the rate when going in either direction,
    // so that the DestinationAmount always ends up being slightly less than
    // the (equivalent) SourceAmount -- regardless of which of the 2 is fixed:
    //
    //   SourceAmount * Rate * (1 - Spread) = DestinationAmount
    //
    const rate = new BigNumber(destinationRate).shift(destinationInfo.assetScale)
      .div(new BigNumber(sourceRate).shift(sourceInfo.assetScale))
      .times(new BigNumber(1).minus(this.spread))
      .toPrecision(15)

    log.debug('quoted rate. from=%s to=%s fromCur=%s toCur=%s rate=%s spread=%s', sourceAccount, destinationAccount, sourceCurrency, destinationCurrency, rate, this.spread)

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
  async submitPayment () {
    return Promise.resolve(undefined)
  }
}
