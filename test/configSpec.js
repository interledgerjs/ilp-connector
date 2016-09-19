'use strict'

const _ = require('lodash')
const loadConnectorConfig = require('ilp-connector')._test.loadConnectorConfig
const expect = require('chai').expect
const fs = require('fs')
const env = _.cloneDeep(process.env)

describe('ConnectorConfig', function () {
  describe('parseConnectorConfig', function () {
    beforeEach(function () {
      process.env.CONNECTOR_LEDGERS = JSON.stringify([
        'USD@usd-ledger.',
        'EUR@eur-ledger.',
        'AUD@aud-ledger.'
      ])
      process.env.CONNECTOR_PAIRS = ''
    })

    afterEach(() => {
      process.env = _.cloneDeep(env)
    })

    it('should auto-generate pairs', function * () {
      const config = loadConnectorConfig()
      expect(config.get('tradingPairs')).to.deep.equal([[
        'USD@usd-ledger.',
        'EUR@eur-ledger.'
      ], [
        'USD@usd-ledger.',
        'AUD@aud-ledger.'
      ], [
        'EUR@eur-ledger.',
        'AUD@aud-ledger.'
      ]])
    })

    describe('ledger credentials', () => {
      it('should parse ledger credentials -- test env', function * () {
        const config = loadConnectorConfig()
        const ledgerCredentials = require('./data/ledgerCredentials.json')
        expect(config.get('ledgerCredentials'))
          .to.deep.equal(ledgerCredentials)
      })

      it('should parse ledger credentials -- deprecated format', function * () {
        const ledgerCredentials = require('./data/ledgerCredentials.json')
        const ledgerCredsModified = _.cloneDeep(ledgerCredentials)
        const usdLedgerCreds = ledgerCredsModified['usd-ledger.']
        usdLedgerCreds.account_uri = usdLedgerCreds.account
        delete usdLedgerCreds.account
        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(ledgerCredsModified)

        const config = loadConnectorConfig()
        expect(config.get('ledgerCredentials'))
          .to.deep.equal(ledgerCredentials)
      })

      it('should parse ledger credentials', function * () {
        const ledgerCredentialsEnv = {
          'cad-ledger.': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
            password: 'mark'
          },
          'usd-ledger.': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
            cert: 'test/data/client1-crt.pem',
            key: 'test/data/client1-key.pem',
            ca: 'test/data/ca-crt.pem'
          }
        }

        process.env.UNIT_TEST_OVERRIDE = 'true'
        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(ledgerCredentialsEnv)
        const config = loadConnectorConfig()

        const ledgerCredentials = {
          'cad-ledger.': {
            type: 'bells',
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
            password: 'mark'
          },
          'usd-ledger.': {
            type: 'bells',
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
            cert: fs.readFileSync('test/data/client1-crt.pem'),
            key: fs.readFileSync('test/data/client1-key.pem'),
            ca: fs.readFileSync('test/data/ca-crt.pem')
          }
        }

        expect(config.get('ledgerCredentials'))
          .to.deep.equal(ledgerCredentials)
      })

      it('should parse another type of ledger\'s credentials', function * () {
        const ledgerCredentialsEnv = {
          'cad-ledger.': {
            token: 'iv8qhtm9qcmjmo8tcmjo4a',
            account: 'mark',
            type: 'other'
          },
          'usd-ledger.': {
            token: 'iv8qhtm9qcmjmo8tcmjo4a',
            account: 'mark',
            type: 'other'
          }
        }

        process.env.UNIT_TEST_OVERRIDE = 'true'
        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(ledgerCredentialsEnv)
        const config = loadConnectorConfig()

        const ledgerCredentials = {
          'cad-ledger.': {
            token: 'iv8qhtm9qcmjmo8tcmjo4a',
            account: 'mark',
            type: 'other'
          },
          'usd-ledger.': {
            token: 'iv8qhtm9qcmjmo8tcmjo4a',
            account: 'mark',
            type: 'other'
          }
        }

        expect(config.get('ledgerCredentials'))
          .to.deep.equal(ledgerCredentials)
      })
    })
  })
})
