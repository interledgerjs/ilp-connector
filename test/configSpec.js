'use strict'

const _ = require('lodash')
const loadConnectorConfig = require('five-bells-connector')._test.loadConnectorConfig
const expect = require('chai').expect
const fs = require('fs')

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
    })

    it('should auto-generate pairs', function *() {
      const config = loadConnectorConfig()
      expect(config.get('tradingPairs').toJS()).to.deep.equal([[
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

    describe('ledger credentials', () => {
      it('should parse ledger credentials -- test env', function * () {
        const config = loadConnectorConfig()
        const ledgerCredentials = require('./data/ledgerCredentials.json')
        expect(config.get('ledgerCredentials').toJS())
          .to.deep.equal(ledgerCredentials)
      })

      it('should parse ledger credentials', function * () {
        const ledgerCredentialsEnv = {
          'http://cad-ledger.example/CAD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            username: 'mark',
            password: 'mark'
          },
          'http://usd-ledger.example/USD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            cert: 'test/data/client1-crt.pem',
            key: 'test/data/client1-key.pem',
            ca: 'test/data/ca-crt.pem'
          }
        }

        process.env.UNIT_TEST_OVERRIDE = 'true'
        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(ledgerCredentialsEnv)
        const config = loadConnectorConfig()

        const ledgerCredentials = {
          'http://cad-ledger.example/CAD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            username: 'mark',
            password: 'mark'
          },
          'http://usd-ledger.example/USD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            cert: fs.readFileSync('test/data/client1-crt.pem'),
            key: fs.readFileSync('test/data/client1-key.pem'),
            ca: fs.readFileSync('test/data/ca-crt.pem')
          }
        }

        expect(config.get('ledgerCredentials').toJS())
          .to.deep.equal(ledgerCredentials)
      })

      it('throws if missing password', () => {
        const missingPassword = {
          'http://cad-ledger.example/CAD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            username: 'mark'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingPassword)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing username or password/)
      })

      it('throws if missing username', () => {
        const missingUsername = {
          'http://cad-ledger.example/CAD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            password: 'mark'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingUsername)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing username or password/)
      })

      it('throws if missing key', () => {
        const missingKey = {
          'http://cad-ledger.example/CAD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            cert: '/cert'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingKey)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing certificate or key/)
      })

      it('throws if missing cert', () => {
        const missingCert = {
          'http://cad-ledger.example/CAD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            key: '/key'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingCert)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing certificate or key/)
      })

      it('throws if missing account_uri', () => {
        const missingAccountUri = {
          'http://cad-ledger.example/CAD': {
            cert: 'test/data/client1-crt.pem',
            key: 'test/data/client1-key.pem',
            ca: 'test/data/ca-crt.pem'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingAccountUri)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing account_uri/)
      })

      it('throws if missing key file', function * () {
        const missingKeyFile = {
          'http://usd-ledger.example/USD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            cert: 'test/data/client1-crt.pem',
            key: 'foo',
            ca: 'test/data/ca-crt.pem'
          }
        }

        process.env.UNIT_TEST_OVERRIDE = 'true'
        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingKeyFile)
        expect(() => loadConnectorConfig()).to.throw().match(/Failed to read credentials/)
      })

      it('throws if missing certificate file', function * () {
        const missingCertFile = {
          'http://usd-ledger.example/USD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            cert: 'foo',
            key: 'test/data/client1-key.pem',
            ca: 'test/data/ca-crt.pem'
          }
        }

        process.env.UNIT_TEST_OVERRIDE = 'true'
        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingCertFile)
        expect(() => loadConnectorConfig()).to.throw().match(/Failed to read credentials/)
      })

      it('throws if missing ca certificate file', function * () {
        const missingCertFile = {
          'http://usd-ledger.example/USD': {
            account_uri: 'http://cad-ledger.example/accounts/mark',
            cert: 'test/data/client1-crt.pem',
            key: 'test/data/client1-key.pem',
            ca: 'foo'
          }
        }

        process.env.UNIT_TEST_OVERRIDE = 'true'
        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingCertFile)
        expect(() => loadConnectorConfig()).to.throw().match(/Failed to read credentials/)
      })
    })
  })
})
