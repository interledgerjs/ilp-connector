'use strict'

const assert = require('assert')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../build/common/log')
const reduct = require('reduct')
const PluginAccountProvider = require('../build/account-providers/plugin')
const MockAccountProvider = require('./mocks/mockAccountProvider')
const MockAccountService = require('./mocks/mockAccountService')
const MockIlpEndpoint = require('./mocks/mockIlpEndpoint')
const Accounts = require('../build/services/accounts').default
const Config = require('../build/services/config').default
const AlertMiddleware = require('../build/middlewares/alert').default
const _ = require('lodash')

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const env = _.cloneDeep(process.env)

describe('accounts', function () {
  logHelper(logger)
  beforeEach(async function () {
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify({
      'test.cad-ledger': {
        'relation': 'parent',
        'assetCode': 'CAD',
        'assetScale': 4,
        'plugin': 'ilp-plugin-mock',
        'disableMiddleware': true
      },
      'test.usd-ledger': {
        'relation': 'peer',
        'assetCode': 'USD',
        'assetScale': 4,
        'plugin': 'ilp-plugin-mock',
        'disableMiddleware': false
      }
    })
    appHelper.create(this)
  })

  afterEach(async function () {
    process.env = _.cloneDeep(env) // Required to remove the environment variables set in beforeEach
  })

  describe('constructor', function () {
    it('loads the plugin account provider by default', async function () {
      const deps = reduct()
      const config = deps(Config)
      config.loadFromEnv()
      const accounts = new Accounts(deps)
      assert.deepStrictEqual(1, accounts._accountProviders.size)
      const accountProviders = accounts._accountProviders.values()
      const pluginProvider = accountProviders.next().value
      assert.ok(pluginProvider instanceof PluginAccountProvider.default)
    })
  })

  it('does not load middleware onto account if account info disableMiddleware is true', async function () {
    await this.accounts.startup()
    const CadLedger = this.accounts.get('test.cad-ledger')
    const UsdLedger = this.accounts.get('test.usd-ledger')
    assert.deepStrictEqual({}, this.accounts.getAccountMiddleware(CadLedger))
    assert.deepStrictEqual(['errorHandler', 'rateLimit', 'maxPacketAmount', 'throughput', 'balance', 'deduplicate', 'expire', 'validateFulfillment', 'stats', 'alert'], Object.keys(this.accounts.getAccountMiddleware(UsdLedger)))
  })

  describe('addAccountProvider', function () {
    it('adds given provider to provider map', async function () {
      const numAccountProvidersBefore = this.accounts._accountProviders.size
      const mockAccountProvider = new MockAccountProvider(reduct(), {})
      this.accounts.addAccountProvider(mockAccountProvider)
      assert.equal(numAccountProvidersBefore + 1, this.accounts._accountProviders.size)
    })

    it('throws error if trying to add provider after startup has been called', async function () {
      try {
        this.accounts.startup()
        const mockAccountProvider = new MockAccountProvider(reduct(), {})
        this.accounts.addAccountProvider(mockAccountProvider)
      }
      catch (e) {
        return
      }
      assert.fail('addAccountProvider did not throw exception.')
    })
  })

  describe('registerAccountMiddleware', function () {
    it('sets the middleware to be used when creating accounts', async function () {
      const middleware = {
        'alert': new AlertMiddleware()
      }
      this.accounts.registerAccountMiddleware(middleware)
      assert.deepEqual(this.accounts._middlewares, middleware)
    })
    it('throws error if trying to register middleware after startup has been called', async function () {
      try {
        this.accounts.startup()
        this.accounts.registerAccountMiddleware({
          'alert': new AlertMiddleware()
        })
      }
      catch (e) {
        return
      }
      assert.fail('addAccountProvider did not throw exception.')
    })
  })

  describe('handleNewAccount', function () {
    beforeEach(function () {
      const accountInfo = {
        'relation': 'parent',
        'assetCode': 'CAD',
        'assetScale': 4,
        'plugin': 'ilp-plugin-mock',
        'disableMiddleware': false
      }
      const mockAccountProvider = new MockAccountProvider()
      const mockIlpEndpoint = new MockIlpEndpoint()
      this.mockAccount = new MockAccountService('test', accountInfo, mockIlpEndpoint)
      this.accounts._handleNewAccount(this.mockAccount, mockAccountProvider)
    })

    afterEach(function() {
      this.mockAccount = undefined
    })

    it('connects incoming middleware pipeline to core handler', async function () {
      
    })

    it('connects outgoing middleware pipeline to the accounts ilp-endpoint', async function () {

    })

    it('registers the outgoing middleware pipeline on to the account', async function () {
      assert.ok(this.mockAccount._outgoingPacketHandler)
    })

    it('sets the handler provider for the account endpoint', async function () {
      assert.ok(this.mockAccount.endpoint.handlerProvider)
    })

    it('stores new account in account map', async function () {
      assert.ok(this.accounts.get('test'))
    })

    it('emits add event', async function () {

    })
  })
})
