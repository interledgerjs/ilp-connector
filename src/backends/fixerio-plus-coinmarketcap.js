'use strict'

const request = require('co-request')
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
    let rateRes = await request({
      method: 'get',
      uri: COINMARKETCAP_API,
      json: true
    })
    if (rateRes.statusCode !== 200) {
      throw new Error('Unexpected status from coinmarketcap.com: ' + rateRes.statusCode)
    }
    return fromPairs(rateRes.body.map((rateInfo) => {
      return [rateInfo.symbol, Math.floor(ROUNDING_FACTOR / (rateInfo.price_usd * usdRate)) / ROUNDING_FACTOR]
    }))
  }
}

module.exports = FixerIoCoinMarketCapBackend
