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

describe('Plugin Profile Mode', function () {
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
      'test.usd-ledger': {
        'relation': 'peer',
        'assetCode': 'USD',
        'assetScale': 4,
        'plugin': 'ilp-plugin-mock',
        'options': {}
      } })
    process.env.CONNECTOR_PROFILE = 'plugin'

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

  it('routes ILP packets sent from plugin directly to parent', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })
    const fulfillPacket = IlpPacket.serializeIlpFulfill({
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.alloc(0)
    })

    sinon.stub(mockPlugin.prototype, 'sendData').resolves(fulfillPacket)
    const result = await this.accounts.get('test.usd-ledger').getPlugin()._dataHandler(preparePacket)
    assert.strictEqual(result.toString('hex'), fulfillPacket.toString('hex'))
  })

  it('routes ILP packets sent from parent directly to plugin', async function () {
    const preparePacket = IlpPacket.serializeIlpPrepare({
      amount: '100',
      executionCondition: Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64'),
      expiresAt: new Date(START_DATE + 2000),
      destination: 'mock.test2.bob',
      data: Buffer.alloc(0)
    })
    const fulfillPacket = IlpPacket.serializeIlpFulfill({
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.alloc(0)
    })

    sinon.stub(mockPlugin.prototype, 'sendData').resolves(fulfillPacket)
    const result = await this.accounts.get('test.cad-ledger').getPlugin()._dataHandler(preparePacket)
    assert.strictEqual(result.toString('hex'), fulfillPacket.toString('hex'))
  })

  it('doesnt have any middleware in parent pipeline', async function () {
    const result = await this.accounts.getAccountMiddleware(this.accounts.get('test.cad-ledger'))
    assert.deepStrictEqual(result, {})
  })

  it('it does have middleware on plugin pipeline', async function () {
    const result = await this.accounts.getAccountMiddleware(this.accounts.get('test.usd-ledger'))

    // Note the this.accounts._middlewares is the instantiated middleware already
    assert.deepStrictEqual(result, this.accounts._middlewares)
  })
})
