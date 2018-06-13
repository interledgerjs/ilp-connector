
import fetch from 'node-fetch'
import ECBBackend from './ecb'
import { fromPairs } from 'lodash'

const COINMARKETCAP_API = 'https://api.coinmarketcap.com/v1/ticker/'
const ROUNDING_FACTOR = 100000000

export default class ECBAndCoinMarketCapBackend extends ECBBackend {
  async connect () {
    await super.connect()
    const ccRates = await this._getCCRates(this.rates.USD)
    Object.assign(this.rates, ccRates)
    this.currencies = this.currencies.concat(Object.keys(ccRates))
    this.currencies.sort()
  }

  private async _getCCRates (usdRate: number) {
    const rateRes = await fetch(COINMARKETCAP_API)
    if (rateRes.status !== 200) {
      throw new Error('Unexpected status from coinmarketcap.com: ' + rateRes.status)
    }
    const body = await rateRes.json()
    return fromPairs(body.map((rateInfo: any) => {
      return [rateInfo.symbol, Math.floor(ROUNDING_FACTOR / (rateInfo.price_usd * usdRate)) / ROUNDING_FACTOR]
    }))
  }
}
