import fetch from 'node-fetch'
import BigNumber from 'bignumber.js'

import { create as createLogger } from '../common/log'
import { BackendInstance, BackendServices } from '../types/backend'
import { AccountInfo } from '../types/accounts'
const log = createLogger('coinmarketcap')

export interface CMCBackendOpts {
  spread: number
  ratesApiUrl: string,
}
const RATES_API = 'https://api.coinmarketcap.com/v2/ticker/'

export default class CMCBackend implements BackendInstance {
  public rates: {}
  protected spread: number
  protected ratesApiUrl: string
  protected getInfo: (accountId: any) => AccountInfo | undefined

  constructor (opts: CMCBackendOpts, api: BackendServices) {
    this.spread = opts.spread | 0
    this.ratesApiUrl = opts.ratesApiUrl || RATES_API
    this.getInfo = api.getInfo
    this.rates = {}

  }

  public async connect () {
    const rateRes = await fetch(this.ratesApiUrl)
    if (rateRes.status !== 200) {
      throw new Error('Unexpected status from coinmarketcap.com: ' + rateRes.status)
    }

    // Get the exchange rate in USD for each currency to use as a benchmark
    const body = await rateRes.json()
    Object.keys(body.data).forEach(k => {
      let currency = body.data[k]
      this.rates[currency.symbol] = currency.quotes['USD'].price
    })

    log.info('data loaded from CoinMarketCap')
  }

  public async getRate (sourceAccount, destinationAccount) {
    const sourceInfo = this.getInfo(sourceAccount)
    const destinationInfo = this.getInfo(destinationAccount)

    if (!sourceInfo) {
      const err = `unable to fetch account info for source account. accountId=${sourceAccount}`
      log.error(err)
      throw new Error(err)
    }

    if (!destinationInfo) {
      const err = `unable to fetch account info for destination account. accountId=${destinationAccount}`
      log.error(err)
      throw new Error(err)
    }

    const sourceCurrency = sourceInfo.assetCode
    const destinationCurrency = destinationInfo.assetCode
    const sourceRate = this.rates[sourceCurrency]
    const destinationRate = this.rates[destinationCurrency]

    if (!sourceRate) {
      const err = `no rate available for source currency. currency=${sourceCurrency}`
      log.error(err)
      throw new Error(err)
    }
    if (!destinationRate) {
      const err = `no rate available for destination currency. currency=${destinationCurrency}`
      log.error(err)
      throw new Error(err)
    }

    const rate = new BigNumber(sourceRate).shiftedBy(sourceInfo.assetScale * -1)
      .div(new BigNumber(destinationRate).shiftedBy(destinationInfo.assetScale * -1))
      .times(new BigNumber(1).minus(this.spread))
      .toPrecision(15)

    return Number(rate)
  }

  // Statistics are not supported
  // tslint:disable-next-line
  async submitPayment () {}
}
