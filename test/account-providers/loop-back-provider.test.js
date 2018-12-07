'use strict'

const Config = require('../../build/services/config').default
const assert = require('assert')
const reduct = require('reduct')
const logHelper = require('../helpers/log')
const logger = require('../../build/common/log')
const LoopBackAccountProvider = require('../../build/account-providers/loop-back').default

describe('server provider', function () {
  logHelper(logger)
  beforeEach(async function () {
    const deps = reduct()
    this.config = deps(Config)
    this.config.store = "memdown"
    const options = {
      defaultAccountInfo: {
        plugin: 'ilp-plugin-btp',
        relation: 'child',
        assetCode: 'USD',
        assetScale: 10
      },
      loopBackAccounts: ['load-test']
    }
    this.provider = new LoopBackAccountProvider(deps, options)
    await this.provider.startup(async (account) => {this.account = account })
  })

  afterEach(async function () {
    this.account = undefined
    await this.provider.shutdown()
  })


  it('creates the specified loop back accounts', async function () {
    assert.ok(this.account)
    assert.deepStrictEqual('load-test', this.account.id)
    assert.deepStrictEqual('ilp-plugin-btp', this.account.info.plugin)
    assert.deepStrictEqual(10, this.account.info.assetScale)
    assert.deepStrictEqual('USD', this.account.info.assetCode)
    assert.deepStrictEqual('child', this.account.info.relation)
  })
})
