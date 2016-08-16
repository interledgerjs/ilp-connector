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
      process.env.CONNECTOR_NOTIFICATION_KEYS = JSON.stringify({
        'usd-ledger.': 'cc:3:11:VIXEKIp-38aZuievH3I3PyOobH6HW-VD4LP6w-4s3gA:518',
        'eur-ledger.': 'cc:3:11:Mjmrcm06fOo-3WOEZu9YDSNfqmn0lj4iOsTVEurtCdI:518',
        'aud-ledger.': 'cc:3:11:xnTtXKlRuFnFFDTgnSxFn9mYMeimdhbWaZXPAp5Pbs0:518'
      })
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

      it('throws if missing password', () => {
        const missingPassword = {
          'cad-ledger.': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingPassword)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing key or password/)
      })

      it('throws if missing username', () => {
        const missingUsername = {
          'cad-ledger.': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            password: 'mark'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingUsername)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing username/)
      })

      it('throws if missing key', () => {
        const missingKey = {
          'cad-ledger.': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
            cert: '/cert'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingKey)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing key or password/)
      })

      it('throws if missing cert', () => {
        const missingCert = {
          'cad-ledger.': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
            key: '/key'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingCert)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing certificate or key/)
      })

      it('throws if missing account', () => {
        const missingAccountUri = {
          'cad-ledger.': {
            username: 'mark',
            cert: 'test/data/client1-crt.pem',
            key: 'test/data/client1-key.pem',
            ca: 'test/data/ca-crt.pem'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingAccountUri)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing account/)
      })

      it('throws if missing key file', function * () {
        const missingKeyFile = {
          'usd-ledger.': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
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
          'usd-ledger.': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
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
          'usd-ledger.': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
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

    describe('ledger notification signing public keys', () => {
      it('defaults to validating notifications -- production', () => {
        process.env.NODE_ENV = 'production'
        const config = loadConnectorConfig()
        expect(config.get('notifications.must_verify')).to.equal(true)
      })

      it('defaults to NOT validating notifications -- non-production', () => {
        process.env.NODE_ENV = undefined
        const config = loadConnectorConfig()
        expect(config.get('notifications.must_verify')).to.equal(false)
      })

      describe('CONNECTOR_NOTIFICATION_VERIFY=true', () => {
        beforeEach(() => {
          process.env.CONNECTOR_NOTIFICATION_VERIFY = '1'
        })

        it('config.notifications.must_verify=true', () => {
          const config = loadConnectorConfig()
          expect(config.get('notifications.must_verify')).to.equal(true)
        })

        it('throws if missing public key for all ledgers', () => {
          process.env.CONNECTOR_NOTIFICATION_KEYS = undefined
          expect(() => loadConnectorConfig()).to.throw().match(/Missing notification signing keys./)
        })

        it('throws if missing public key for any ledger', () => {
          process.env.CONNECTOR_NOTIFICATION_KEYS = JSON.stringify({
            // 'https://usd-ledger.example': 'test/data/ledger1public.pem',
            'eur-ledger.': 'test/data/ledger2public.pem',
            'aud-ledger.': 'test/data/ledger3public.pem'
          })
          expect(() => loadConnectorConfig()).to.throw().match(/Missing notification signing keys./)
        })

        it('throws if missing public key file for any ledger', () => {
          process.env.CONNECTOR_NOTIFICATION_KEYS = JSON.stringify({
            'usd-ledger.': 'test/foo',
            'eur-ledger.': 'test/data/ledger2public.pem',
            'aud-ledger.': 'test/data/ledger3public.pem'
          })
          expect(() => loadConnectorConfig())
            .to.throw().match(/Failed to read signing key for ledger usd-ledger./)
        })

        it('parses keys', () => {
          const config = loadConnectorConfig()
          expect(config.get('notifications.keys')).to.deep.equal({
            'usd-ledger.': 'cc:3:11:VIXEKIp-38aZuievH3I3PyOobH6HW-VD4LP6w-4s3gA:518',
            'eur-ledger.': 'cc:3:11:Mjmrcm06fOo-3WOEZu9YDSNfqmn0lj4iOsTVEurtCdI:518',
            'aud-ledger.': 'cc:3:11:xnTtXKlRuFnFFDTgnSxFn9mYMeimdhbWaZXPAp5Pbs0:518'
          })
        })
      })

      describe('CONNECTOR_NOTIFICATION_VERIFY=false -- production', () => {
        beforeEach(() => {
          process.env.CONNECTOR_NOTIFICATION_VERIFY = '0'
          process.env.NODE_ENV = 'production'
        })

        it('config.notifications.must_verify=false', () => {
          const config = loadConnectorConfig()
          expect(config.get('notifications.must_verify')).to.equal(false)
        })

        it('does not throw if missing public key for any ledger', () => {
          process.env.CONNECTOR_NOTIFICATION_KEYS = JSON.stringify({
            // 'https://usd-ledger.example': 'test/data/ledger1public.pem',
            'eur-ledger.': 'test/data/ledger2public.pem',
            'aud-ledger.': 'test/data/ledger3public.pem'
          })
          expect(() => loadConnectorConfig()).to.not.throw()
        })
      })
    })
  })
})
