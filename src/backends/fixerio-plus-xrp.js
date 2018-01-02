'use strict'
const fetch = require('node-fetch')
const FixerIoBackend = require('./fixerio')
const CHARTS_API = 'https://api.ripplecharts.com/api/exchange_rates'
const EUR_ISSUER = 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' // bitstamp

class FixerIoXRPBackend extends FixerIoBackend {
  async connect (mockData) {
    await super.connect(mockData)
    this.rates.XRP = await this._getXRPRate()
    this.currencies.push('XRP')
    this.currencies.sort()
  }

  async _getXRPRate () {
    const rateRes = await fetch(CHARTS_API, {
      method: 'POST',
      body: JSON.stringify({
        base: {
          currency: 'EUR',
          issuer: EUR_ISSUER
        },
        counter: { currency: 'XRP' }
      })
    })
    if (rateRes.status !== 200) {
      throw new Error('Unexpected status from ripplecharts: ' + rateRes.status)
    }
    const body = await rateRes.json()
    return +(body[0].rate.toFixed(5))
  }
}

module.exports = FixerIoXRPBackend
