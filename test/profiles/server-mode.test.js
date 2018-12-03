'use strict'

const assert = require('assert')
const sinon = require('sinon')
const { cloneDeep } = require('lodash')
const IlpPacket = require('ilp-packet')
const appHelper = require('../helpers/app')
const logHelper = require('../helpers/log')
const logger = require('../../build/common/log')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const mockPlugin = require('../mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const env = cloneDeep(process.env)

describe('Server Profile Mode', function () {
  logHelper(logger)
  beforeEach(async function () {
    process.env.DEBUG = '*'
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify({
      'test.cad-ledger': {
        'relation': 'parent',
        'assetCode': 'CAD',
        'assetScale': 4,
        'plugin': 'ilp-plugin-mock',
        'options': {}
      }
    })
    process.env.CONNECTOR_PROFILE = 'server'

    appHelper.create(this)
    this.clock = sinon.useFakeTimers(START_DATE)

    this.accounts.setOwnAddress(this.config.ilpAddress)
    await this.accounts.startup()

    await this.backend.connect()
    await this.routeBroadcaster.reloadLocalRoutes()
  })

  afterEach(async function () {
    this.clock.restore()
    process.env = cloneDeep(env)
  })

  it('loads server account service provider', async function () {

  })

  it('routes ILP packets sent from parent directly to plugin', async function () {

  })

  it('doesnt have any middleware in parent pipeline', async function () {

  })

  it('it does have middleware on plugin pipeline', async function () {

  })
})
