'use strict'

const assert = require('assert')
const sinon = require('sinon')
const { cloneDeep } = require('lodash')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../build/common/log')
const PluginAccountProvider = require("../build/account-providers/plugin")
const BtpServerAccountProvider = require("../build/account-providers/btp-server")

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

describe('accounts', function () {
  logHelper(logger)
  beforeEach(async function () {
    const defaultAccountInfo = {
      assetScale: 1,
      assetCode: 'USD',
      relation: 'peer',
      plugin: 'ilp-plugin-btp',
    }
    process.env.CONNECTOR_ACCOUNT_PROVIDERS = JSON.stringify({
      "plugin": {
        type: 'plugin',
        options: {
        },
      },
      'server': {
        type: 'btp-server',
        options: {
          defaultAccountInfo,
          listener: { port: 5555 }
        }
      }
    })
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

    await this.accounts.startup()
  })

  afterEach(async function () {
    //shutdown ws server
    const accountProviders = this.accounts._accountProviders.values()
    accountProviders.next()
    accountProviders.next().value.shutdown()
  })

  it('loads the specified account providers', async function () {
    assert.deepStrictEqual(2, this.accounts._accountProviders.size)
    const accountProviders = this.accounts._accountProviders.values()
    const pluginProvider = accountProviders.next().value
    const btpServerProvider = accountProviders.next().value
    assert.ok(pluginProvider instanceof PluginAccountProvider.default)
    assert.ok(btpServerProvider instanceof BtpServerAccountProvider.default)
  })

  it('does not load middleware onto account if account info disableMiddleware is true', async function () {
    const CadLedger = this.accounts.get('test.cad-ledger')
    const UsdLedger = this.accounts.get('test.usd-ledger')
    assert.deepStrictEqual({}, this.accounts.getAccountMiddleware(CadLedger))
    assert.deepStrictEqual(['errorHandler', 'rateLimit', 'maxPacketAmount', 'throughput', 'balance', 'deduplicate', 'expire', 'validateFulfillment', 'stats', 'alert'], Object.keys(this.accounts.getAccountMiddleware(UsdLedger)))
  })
})