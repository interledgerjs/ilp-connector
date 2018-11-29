'use strict'

const assert = require('assert')
const sinon = require('sinon')
const { cloneDeep } = require('lodash')
const IlpPacket = require('ilp-packet')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../build/common/log')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const env = cloneDeep(process.env)

describe('server provider', function () {
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
      },
    })
    process.env.CONNECTOR_PROFILE = 'server'

    appHelper.create(this)
    this.accounts.setOwnAddress(this.config.ilpAddress)
    await this.accounts.startup()
    await this.backend.connect()
    await this.routeBroadcaster.reloadLocalRoutes()
  })


  afterEach(async function () {
    process.env = cloneDeep(env)
  })

  describe('startup', function () {

    it('registers handler', async function () {

    })

    it('starts a ws server', async function () {

    })

  })

  describe('handle new connection', async function () {

  })

})
