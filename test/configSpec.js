'use strict'

const _ = require('lodash')
const loadConnectorConfig = require('five-bells-connector')._test.loadConnectorConfig
const expect = require('chai').expect

describe('ConnectorConfig', function () {
  describe('parseConnectorConfig', function () {
    const env = _.cloneDeep(process.env)

    beforeEach(function *() {
      process.env = _.cloneDeep(env)
      process.env.CONNECTOR_LEDGERS = JSON.stringify([
        'USD@https://usd-ledger.example',
        'EUR@https://eur-ledger.example',
        'AUD@https://aud-ledger.example'
      ])
      process.env.CONNECTOR_PAIRS = ''

      this.config = loadConnectorConfig()
    })

    it('should auto-generate pairs', function *() {
      expect(this.config.get('tradingPairs').toJS()).to.deep.equal([[
        'USD@https://usd-ledger.example',
        'EUR@https://eur-ledger.example'
      ], [
        'USD@https://usd-ledger.example',
        'AUD@https://aud-ledger.example'
      ], [
        'EUR@https://eur-ledger.example',
        'AUD@https://aud-ledger.example'
      ]])
    })
  })
})
