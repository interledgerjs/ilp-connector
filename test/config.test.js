'use strict'

const _ = require('lodash')
const Config = require('../src/services/config')
const expect = require('chai').expect
const assert = require('chai').assert
const env = _.cloneDeep(process.env)

describe('ConnectorConfig', function () {
  describe('parseConnectorConfig', function () {
    beforeEach(function () {
      process.env.CONNECTOR_ACCOUNTS = JSON.stringify({
        'usd-ledger': {
          currency: 'USD',
          plugin: 'ilp-plugin-mock',
          options: {}
        },
        'eur-ledger': {
          currency: 'EUR',
          plugin: 'ilp-plugin-mock',
          options: {}
        },
        'aud-ledger': {
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
      const config = new Config()
      expect(Buffer.isBuffer(config.secret)).to.be.true
      expect(config.secret).to.have.length(32)
    })

    describe('connector routes', () => {
      beforeEach(function () {
        this.routes = [{
          targetPrefix: 'a.',
          peerAddress: 'example.a'
        }]
      })

      afterEach(() => {
        process.env = _.cloneDeep(env)
      })

      it('parses routes correctly', function () {
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        const config = new Config()
        expect(config.get('routes'))
          .to.deep.equal(this.routes)
      })

      it('won\'t parse routes with invalid ledger', function () {
        this.routes[0].peerAddress = 'garbage!'
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        assert.throws(() => {
          return new Config()
        })
      })

      it('should not parse routes missing prefix', function () {
        this.routes[0].targetPrefix = undefined
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)
        assert.throws(() => {
          return new Config()
        })
      })

      it('should not parse routes missing ledger', function () {
        this.routes[0].peerAddress = undefined
        process.env.CONNECTOR_ROUTES = JSON.stringify(this.routes)

        assert.throws(() => {
          return new Config()
        })
      })
    })

    describe('ledger credentials', () => {
      it('should parse ledger credentials -- deprecated format', async function () {
        const accountCredentials = require('./data/accountCredentials.json')
        const ledgerCredsModified = _.cloneDeep(accountCredentials)
        const usdLedgerCreds = ledgerCredsModified['usd-ledger']
        usdLedgerCreds.options.account_uri = usdLedgerCreds.account
        delete usdLedgerCreds.account
        process.env.CONNECTOR_ACCOUNTS = JSON.stringify(ledgerCredsModified)

        const config = new Config()
        expect(config.get('accountCredentials'))
          .to.deep.equal(accountCredentials)
      })

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

        expect(config.get('accountCredentials'))
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

        expect(config.get('accountCredentials'))
          .to.deep.equal(accountCredentials)
      })
    })
  })
})
