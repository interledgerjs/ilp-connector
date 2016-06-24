'use strict'

const _ = require('lodash')
const loadConnectorConfig = require('five-bells-connector')._test.loadConnectorConfig
const expect = require('chai').expect
const fs = require('fs')
const env = _.cloneDeep(process.env)

describe('ConnectorConfig', function () {
  describe('parseConnectorConfig', function () {
    beforeEach(function () {
      process.env.CONNECTOR_LEDGERS = JSON.stringify([
        'USD@https://usd-ledger.example',
        'EUR@https://eur-ledger.example',
        'AUD@https://aud-ledger.example'
      ])
      process.env.CONNECTOR_PAIRS = ''
      process.env.CONNECTOR_NOTIFICATION_KEYS = JSON.stringify({
        'https://usd-ledger.example': 'cc:3:11:VIXEKIp-38aZuievH3I3PyOobH6HW-VD4LP6w-4s3gA:518',
        'https://eur-ledger.example': 'cc:3:11:Mjmrcm06fOo-3WOEZu9YDSNfqmn0lj4iOsTVEurtCdI:518',
        'https://aud-ledger.example': 'cc:3:11:xnTtXKlRuFnFFDTgnSxFn9mYMeimdhbWaZXPAp5Pbs0:518'
      })
    })

    afterEach(() => {
      process.env = _.cloneDeep(env)
    })

    afterEach(function () {
      process.env = _.cloneDeep(env)
    })

    it('should auto-generate pairs', function * () {
      const config = loadConnectorConfig()
      expect(config.get('tradingPairs')).to.deep.equal([[
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
        expect(config.get('ledgerCredentials'))
          .to.deep.equal(ledgerCredentials)
      })

      it('should parse ledger credentials', function * () {
        const ledgerCredentialsEnv = {
          'http://cad-ledger.example:1000': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
            password: 'mark'
          },
          'http://usd-ledger.example': {
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
          'http://cad-ledger.example:1000': {
            type: 'bells',
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark',
            password: 'mark'
          },
          'http://usd-ledger.example': {
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
          'http://cad-ledger.example:1000': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            username: 'mark'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingPassword)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing key or password/)
      })

      it('throws if missing username', () => {
        const missingUsername = {
          'http://cad-ledger.example:1000': {
            account: 'http://cad-ledger.example:1000/accounts/mark',
            password: 'mark'
          }
        }

        process.env.CONNECTOR_CREDENTIALS = JSON.stringify(missingUsername)
        expect(() => loadConnectorConfig()).to.throw().match(/Missing username/)
      })

      it('throws if missing key', () => {
        const missingKey = {
          'http://cad-ledger.example:1000': {
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
          'http://cad-ledger.example:1000': {
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
          'http://cad-ledger.example:1000': {
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
          'http://usd-ledger.example': {
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
          'http://usd-ledger.example': {
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
          'http://usd-ledger.example': {
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
            'https://eur-ledger.example': 'test/data/ledger2public.pem',
            'https://aud-ledger.example': 'test/data/ledger3public.pem'
          })
          expect(() => loadConnectorConfig()).to.throw().match(/Missing notification signing keys./)
        })

        it('throws if missing public key file for any ledger', () => {
          process.env.CONNECTOR_NOTIFICATION_KEYS = JSON.stringify({
            'https://usd-ledger.example': 'test/foo',
            'https://eur-ledger.example': 'test/data/ledger2public.pem',
            'https://aud-ledger.example': 'test/data/ledger3public.pem'
          })
          expect(() => loadConnectorConfig())
            .to.throw().match(/Failed to read signing key for ledger https:\/\/usd-ledger.example/)
        })

        it('parses keys', () => {
          const config = loadConnectorConfig()
          expect(config.get('notifications.keys')).to.deep.equal({
            'https://usd-ledger.example': 'cc:3:11:VIXEKIp-38aZuievH3I3PyOobH6HW-VD4LP6w-4s3gA:518',
            'https://eur-ledger.example': 'cc:3:11:Mjmrcm06fOo-3WOEZu9YDSNfqmn0lj4iOsTVEurtCdI:518',
            'https://aud-ledger.example': 'cc:3:11:xnTtXKlRuFnFFDTgnSxFn9mYMeimdhbWaZXPAp5Pbs0:518'
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
            'https://eur-ledger.example': 'test/data/ledger2public.pem',
            'https://aud-ledger.example': 'test/data/ledger3public.pem'
          })
          expect(() => loadConnectorConfig()).to.not.throw()
        })
      })
    })
  })
})
