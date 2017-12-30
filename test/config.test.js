'use strict'

const _ = require('lodash')
const Config = require('../src/services/config')
const expect = require('chai').expect
const assert = require('chai').assert
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const env = _.cloneDeep(process.env)

describe('Config', function () {
  logHelper(logger)

  describe('parseConnectorConfig', function () {
    beforeEach(function () {
      process.env.CONNECTOR_ACCOUNTS = JSON.stringify({
        'usd-ledger': {
          relation: 'peer',
          currency: 'USD',
          currencyScale: 4,
          plugin: 'ilp-plugin-mock',
          options: {}
        },
        'eur-ledger': {
          relation: 'peer',
          currency: 'EUR',
          currencyScale: 4,
          plugin: 'ilp-plugin-mock',
          options: {}
        },
        'aud-ledger': {
          relation: 'peer',
          currency: 'AUD',
          currencyScale: 4,
          plugin: 'ilp-plugin-mock',
          options: {}
        }
      })
      process.env.CONNECTOR_PAIRS = ''
    })

    afterEach(() => {
      process.env = _.cloneDeep(env)
    })

    describe('connector routes', () => {
      beforeEach(function () {
        this.routes = [{
          targetPrefix: 'a.',
          peerId: 'example.a'
        }]
      })

      afterEach(() => {
        process.env = _.cloneDeep(env)
      })

      it('parses routes correctly', function () {
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        const config = new Config()
        config.loadFromEnv()
        expect(config.get('routes'))
          .to.deep.equal(this.routes)
      })

      it('won\'t parse routes with invalid ledger', function () {
        this.routes[0].peerId = 'garbage!'
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        const config = new Config()
        config.loadFromEnv()
        assert.throws(() => {
          config.validate()
        }, 'config failed to validate. error=should match pattern "^[a-zA-Z0-9._~-]+$" dataPath=.routes[0].peerId')
      })

      it('should not parse routes missing prefix', function () {
        this.routes[0].targetPrefix = undefined
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        const config = new Config()
        config.loadFromEnv()
        assert.throws(() => {
          config.validate()
        }, 'config failed to validate. error=should have required property \'targetPrefix\' dataPath=.routes[0]')
      })

      it('should not parse routes missing ledger', function () {
        this.routes[0].peerId = undefined
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)

        const config = new Config()
        config.loadFromEnv()
        assert.throws(() => {
          config.validate()
        }, 'config failed to validate. error=should have required property \'peerId\' dataPath=.routes[0]')
      })
    })

    describe('ledger credentials', () => {
      it('should parse ledger credentials', async function () {
        const accountCredentialsEnv = {
          'cad-ledger': {
            currency: 'CAD',
            plugin: 'ilp-plugin-mock',
            options: {
              account: 'http://cad-ledger.example:1000/accounts/mark',
              username: 'mark',
              password: 'mark'
            }
          },
          'usd-ledger': {
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
        process.env.CONNECTOR_ACCOUNTS = JSON.stringify(accountCredentialsEnv)
        const config = new Config()
        config.loadFromEnv()

        const accountCredentials = {
          'cad-ledger': {
            currency: 'CAD',
            plugin: 'ilp-plugin-mock',
            options: {
              account: 'http://cad-ledger.example:1000/accounts/mark',
              username: 'mark',
              password: 'mark'
            }
          },
          'usd-ledger': {
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

        expect(config.accounts)
          .to.deep.equal(accountCredentials)
      })

      it('should parse another type of ledger\'s credentials', async function () {
        const accountCredentialsEnv = {
          'cad-ledger': {
            currency: 'USD',
            plugin: 'ilp-plugin-mock',
            options: {
              token: 'iv8qhtm9qcmjmo8tcmjo4a',
              account: 'mark',
              type: 'other'
            }
          },
          'usd-ledger': {
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
        process.env.CONNECTOR_ACCOUNTS = JSON.stringify(accountCredentialsEnv)
        const config = new Config()
        config.loadFromEnv()

        const accountCredentials = {
          'cad-ledger': {
            currency: 'USD',
            plugin: 'ilp-plugin-mock',
            options: {
              token: 'iv8qhtm9qcmjmo8tcmjo4a',
              account: 'mark',
              type: 'other'
            }
          },
          'usd-ledger': {
            currency: 'USD',
            plugin: 'ilp-plugin-mock',
            options: {
              token: 'iv8qhtm9qcmjmo8tcmjo4a',
              account: 'mark',
              type: 'other'
            }
          }
        }

        expect(config.accounts)
          .to.deep.equal(accountCredentials)
      })
    })
  })
})
