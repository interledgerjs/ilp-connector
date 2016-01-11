'use strict'

const Config = require('../lib/config')
const expect = require('chai').expect

describe('ConnectorConfig', function () {
  describe('parseConnectorConfig', function () {
    beforeEach(function *() {
      process.env = {}
      this.config = new Config()
      this.config.parseServerConfig()
    })

    it('should auto-generate pairs', function *() {
      process.env.CONNECTOR_LEDGERS = JSON.stringify([
        'USD@https://usd-ledger.example',
        'EUR@https://eur-ledger.example',
        'AUD@https://aud-ledger.example'
      ])
      this.config.parseConnectorConfig()

      expect(this.config.tradingPairs).to.deep.equal([[
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
