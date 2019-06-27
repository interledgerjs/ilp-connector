import fetchUri from 'node-fetch'
import * as sax from 'sax'
import BigNumber from 'bignumber.js'
import { AccountInfo } from '../types/accounts'
import { BackendInstance, BackendServices } from '../types/backend'

import { create as createLogger } from '../common/log'
const log = createLogger('ecb')

const RATES_API = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

export interface ECBBackendOptions {
  spread: number,
  ratesApiUrl: string,
  mockData: ECBAPIData
}

export interface ECBSaxNode {
  name: string,
  attributes: {
    time?: number
    currency?: string
    rate?: number
  }
}

export interface ECBAPIData {
  base: string
  date?: number
  rates: {
    [key: string]: number
  }
}

/**
 * Dummy backend that uses the ECB API for FX rates
 */
export default class ECBBackend implements BackendInstance {
  protected spread: number
  protected ratesApiUrl: string
  protected getInfo: (accountId: string) => AccountInfo | undefined

  protected rates: {
    [key: string]: number
  }
  protected currencies: string[]
  private mockData: ECBAPIData

  /**
   * Constructor.
   *
   * @param opts.spread The spread we will use to mark up the FX rates
   * @param opts.ratesApiUrl The URL for querying the ECB API
   * @param api.getInfo Method which maps account IDs to AccountInfo objects
   * @param api.getAssetCode Method which maps account IDs to asset code
   */
  constructor (opts: ECBBackendOptions, api: BackendServices) {
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
    let apiData: ECBAPIData
    if (this.mockData) {
      log.info('connect using mock data.')
      apiData = this.mockData
    } else {
      log.info('connect. uri=' + this.ratesApiUrl)
      let result = await fetchUri(this.ratesApiUrl)
      apiData = await parseXMLResponse(await result.text())
    }
    this.rates = apiData.rates
    this.rates[apiData.base] = 1
    this.currencies = Object.keys(this.rates)
    this.currencies.sort()
    log.info('data loaded. numCurrencies=' + this.currencies.length)
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
      log.error('unable to fetch account info for source account. accountId=%s', sourceAccount)
      throw new Error('unable to fetch account info for source account. accountId=' + sourceAccount)
    }
    if (!destinationInfo) {
      log.error('unable to fetch account info for destination account. accountId=%s', destinationAccount)
      throw new Error('unable to fetch account info for destination account. accountId=' + destinationAccount)
    }

    const sourceCurrency = sourceInfo.assetCode
    const destinationCurrency = destinationInfo.assetCode

    // Get ratio between currencies and apply spread
    const sourceRate = this.rates[sourceCurrency]
    const destinationRate = this.rates[destinationCurrency]

    if (!sourceRate) {
      log.error('no rate available for source currency. currency=%s', sourceCurrency)
      throw new Error('no rate available. currency=' + sourceCurrency)
    }

    if (!destinationRate) {
      log.error('no rate available for destination currency. currency=%s', destinationCurrency)
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

    log.trace('quoted rate. from=%s to=%s fromCur=%s toCur=%s rate=%s spread=%s', sourceAccount, destinationAccount, sourceCurrency, destinationCurrency, rate, this.spread)

    return Number(rate)
  }

  /**
   * This method is called to allow statistics to be collected by the backend.
   *
   * The ECB backend does not support this functionality.
   */
  async submitPayment () {
    return Promise.resolve(undefined)
  }
}

function parseXMLResponse (data: string): Promise<ECBAPIData> {
  const parser = sax.parser(true, {})
  const apiData: ECBAPIData = { base: 'EUR', rates: {} }
  parser.onopentag = (node: ECBSaxNode) => {
    if (node.name === 'Cube' && node.attributes.time) {
      apiData.date = node.attributes.time
    }
    if (node.name === 'Cube' && node.attributes.currency && node.attributes.rate) {
      apiData.rates[node.attributes.currency] = node.attributes.rate
    }
  }
  return new Promise((resolve, reject) => {
    parser.onerror = reject
    parser.onend = () => resolve(apiData)
    parser.write(data).close()
  })
}
