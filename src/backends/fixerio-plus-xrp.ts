import fetch from 'node-fetch'
import FixerIoBackend from './fixerio'
import { create as createLogger } from '../common/log'
const log = createLogger('fixerio-plus-xrp')

// Bitstamp/EUR
const CHARTS_API = 'https://data.ripple.com/v2/exchange_rates/EUR+rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq/XRP'

export default class FixerIoXRPBackend extends FixerIoBackend {
  async connect () {
    await super.connect()
    // XRP rate may have been loaded as part of the mock data
    if (!this.rates.XRP) {
      this.rates.XRP = await this._getXRPRate()
    }
    this.currencies.push('XRP')
    this.currencies.sort()
  }

  async _getXRPRate () {
    const rateRes = await fetch(CHARTS_API)
    if (rateRes.status !== 200) {
      throw new Error('unexpected HTTP status code from Ripple Data API. status=' + rateRes.status)
    }
    const body = await rateRes.json()
    const rate = Number(body.rate).toFixed(5)
    log.debug('loaded EUR/XRP rate. rate=%s', rate)
    return Number(rate)
  }
}
