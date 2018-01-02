'use strict'

const fetch = require('node-fetch')
const FixerIoBackend = require('./fixerio')
const COINMARKETCAP_API = 'https://api.coinmarketcap.com/v1/ticker/'
const fromPairs = require('lodash/fromPairs')
const ROUNDING_FACTOR = 100000000

class FixerIoCoinMarketCapBackend extends FixerIoBackend {
  async connect (mockData) {
    await super.connect(mockData)
    const ccRates = await this._getCCRates(this.rates.USD)
    Object.assign(this.rates, ccRates)
    this.currencies = this.currencies.concat(Object.keys(ccRates))
    this.currencies.sort()
  }

  async _getCCRates (usdRate) {
    const rateRes = await fetch(COINMARKETCAP_API)
    if (rateRes.status !== 200) {
      throw new Error('Unexpected status from coinmarketcap.com: ' + rateRes.status)
    }
    const body = await rateRes.json()
    return fromPairs(body.map((rateInfo) => {
      return [rateInfo.symbol, Math.floor(ROUNDING_FACTOR / (rateInfo.price_usd * usdRate)) / ROUNDING_FACTOR]
    }))
  }
}

module.exports = FixerIoCoinMarketCapBackend
