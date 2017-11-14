'use strict'

const _ = require('lodash')
const loadConnectorConfig = require('../src/lib/config')
const expect = require('chai').expect
const assert = require('chai').assert
const env = _.cloneDeep(process.env)

describe('ConnectorConfig', function () {
  describe('parseConnectorConfig', function () {
    beforeEach(function () {
      process.env.CONNECTOR_LEDGERS = JSON.stringify({
        'usd-ledger.': {
          currency: 'USD',
          plugin: 'ilp-plugin-mock',
          options: {}
        },
        'eur-ledger.': {
          currency: 'EUR',
          plugin: 'ilp-plugin-mock',
          options: {}
        },
        'aud-ledger.': {
          currency: 'AUD',
          plugin: 'ilp-plugin-mock',
          options: {}
        }
      })
      process.env.CONNECTOR_PAIRS = ''
    })

    afterEach(() => {
      process.env = _.cloneDeep(env)
    })

    it('should generate a secret if one is not provided', async function () {
      delete process.env.CONNECTOR_SECRET
      const config = loadConnectorConfig()
      expect(Buffer.isBuffer(config.secret)).to.be.true
      expect(config.secret).to.have.length(32)
    })

    it('should auto-generate pairs', async function () {
      const config = loadConnectorConfig()
      expect(config.get('tradingPairs')).to.deep.equal([[
        'USD@usd-ledger.',
        'USD@usd-ledger.'
      ], [
        'USD@usd-ledger.',
        'EUR@eur-ledger.'
      ], [
        'EUR@eur-ledger.',
        'USD@usd-ledger.'
      ], [
        'USD@usd-ledger.',
        'AUD@aud-ledger.'
      ], [
        'AUD@aud-ledger.',
        'USD@usd-ledger.'
      ], [
        'EUR@eur-ledger.',
        'EUR@eur-ledger.'
      ], [
        'EUR@eur-ledger.',
        'AUD@aud-ledger.'
      ], [
        'AUD@aud-ledger.',
        'EUR@eur-ledger.'
      ], [
        'AUD@aud-ledger.',
        'AUD@aud-ledger.'
      ]])
    })

    describe('connector routes', () => {
      beforeEach(function () {
        this.routes = [{
          targetPrefix: 'a.',
          connectorAccount: 'example.a',
          connectorLedger: 'example.'
        }]
      })

      afterEach(() => {
        process.env = _.cloneDeep(env)
      })

      it('parses routes correctly', function () {
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        const config = loadConnectorConfig()
        expect(config.get('configRoutes'))
          .to.deep.equal(this.routes)
      })

      it('won\'t parse routes with invalid ledger', function () {
        this.routes[0].connectorLedger = 'garbage'
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        try {
          loadConnectorConfig()
          assert(false)
        } catch (e) {
          assert.isTrue(true)
        }
      })

      it('won\'t parse routes with non-matching ledger and connector', function () {
        this.routes[0].connectorAccount = 'other.connector'
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        try {
          loadConnectorConfig()
          assert(false)
        } catch (e) {
          assert.isTrue(true)
        }
      })

      it('should not parse routes missing prefix', function () {
        this.routes[0].targetPrefix = undefined
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        try {
          loadConnectorConfig()
          assert(false)
        } catch (e) {
          assert.isTrue(true)
        }
      })

      it('should not parse routes missing ledger', function () {
        this.routes[0].connectorLedger = undefined
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        try {
          loadConnectorConfig()
          assert(false)
        } catch (e) {
          assert.isTrue(true)
        }
      })

      it('should not parse routes missing account', function () {
        this.routes[0].connectorAccount = undefined
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        try {
          loadConnectorConfig()
          assert(false)
        } catch (e) {
          assert.isTrue(true)
        }
      })
    })

    describe('ledger credentials', () => {
      it('should parse ledger credentials -- deprecated format', async function () {
        const ledgerCredentials = require('./data/ledgerCredentials.json')
        const ledgerCredsModified = _.cloneDeep(ledgerCredentials)
        const usdLedgerCreds = ledgerCredsModified['usd-ledger.']
        usdLedgerCreds.options.account_uri = usdLedgerCreds.account
        delete usdLedgerCreds.account
        process.env.CONNECTOR_LEDGERS = JSON.stringify(ledgerCredsModified)

        const config = loadConnectorConfig()
        expect(config.get('ledgerCredentials'))
          .to.deep.equal(ledgerCredentials)
      })

      it('should parse ledger credentials', async function () {
        const ledgerCredentialsEnv = {
          'cad-ledger.': {
            currency: 'CAD',
            plugin: 'ilp-plugin-mock',
            options: {
              account: 'http://cad-ledger.example:1000/accounts/mark',
              username: 'mark',
              password: 'mark'
            }
          },
          'usd-ledger.': {
            currency: 'USD',
            plugin: 'ilp-plugin-mock',
            options: {
              account: 'http://cad-ledger.example:1000/accounts/mark',
              username: 'mark',
              cert: 'test/data/client1-crt.pem',
              key: 'test/data/client1-key.pem',
              ca: 'test/data/ca-crt.pem'
            }
          }
        }

        process.env.UNIT_TEST_OVERRIDE = 'true'
        process.env.CONNECTOR_LEDGERS = JSON.stringify(ledgerCredentialsEnv)
        const config = loadConnectorConfig()

        const ledgerCredentials = {
          'cad-ledger.': {
            currency: 'CAD',
            plugin: 'ilp-plugin-mock',
            options: {
              account: 'http://cad-ledger.example:1000/accounts/mark',
              username: 'mark',
              password: 'mark'
            }
          },
          'usd-ledger.': {
            currency: 'USD',
            plugin: 'ilp-plugin-mock',
            options: {
              account: 'http://cad-ledger.example:1000/accounts/mark',
              username: 'mark',
              cert: 'test/data/client1-crt.pem',
              key: 'test/data/client1-key.pem',
              ca: 'test/data/ca-crt.pem'
            }
          }
        }

        expect(config.get('ledgerCredentials'))
          .to.deep.equal(ledgerCredentials)
      })

      it('should parse another type of ledger\'s credentials', async function () {
        const ledgerCredentialsEnv = {
          'cad-ledger.': {
            currency: 'USD',
            plugin: 'ilp-plugin-mock',
            options: {
              token: 'iv8qhtm9qcmjmo8tcmjo4a',
              account: 'mark',
              type: 'other'
            }
          },
          'usd-ledger.': {
            currency: 'USD',
            plugin: 'ilp-plugin-mock',
            options: {
              token: 'iv8qhtm9qcmjmo8tcmjo4a',
              account: 'mark',
              type: 'other'
            }
          }
        }

        process.env.UNIT_TEST_OVERRIDE = 'true'
        process.env.CONNECTOR_LEDGERS = JSON.stringify(ledgerCredentialsEnv)
        const config = loadConnectorConfig()

        const ledgerCredentials = {
          'cad-ledger.': {
            currency: 'USD',
            plugin: 'ilp-plugin-mock',
            options: {
              token: 'iv8qhtm9qcmjmo8tcmjo4a',
              account: 'mark',
              type: 'other'
            }
          },
          'usd-ledger.': {
            currency: 'USD',
            plugin: 'ilp-plugin-mock',
            options: {
              token: 'iv8qhtm9qcmjmo8tcmjo4a',
              account: 'mark',
              type: 'other'
            }
          }
        }

        expect(config.get('ledgerCredentials'))
          .to.deep.equal(ledgerCredentials)
      })
    })
  })
})
