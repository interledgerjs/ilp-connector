'use strict'

const { assert } = require('chai')
const sinon = require('sinon')
const packet = require('ilp-packet')
const { cloneDeep } = require('lodash')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../src/common/log')
const InterledgerRejectionError = require('../src/errors/interledger-rejection-error')
const LiquidityCurve = require('../src/routing/liquidity-curve')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const ledgerA = 'usd-ledger'
const ledgerB = 'eur-ledger'
const ledgerC = 'cny-ledger'

// sending/receiving users
const bobB = 'eur-ledger.bob'
const carlC = 'cny-ledger.carl'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const env = cloneDeep(process.env)

describe('RouteBuilder', function () {
  logHelper(logger)
  beforeEach(async function () {
    const accountCredentials = {}
    accountCredentials[ledgerA] = {
      currency: 'USD',
      plugin: 'ilp-plugin-mock',
      options: {}
    }
    accountCredentials[ledgerB] = {
      currency: 'EUR',
      plugin: 'ilp-plugin-mock',
      options: {}
    }
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify(accountCredentials)
    process.env.CONNECTOR_FX_SPREAD = 0.1
    appHelper.create(this)
    this.routeBroadcaster.reloadLocalRoutes()
    await this.backend.connect({
      base: 'EUR',
      date: '2015-03-18',
      rates: {
        USD: 1.8
      }
    })
    this.accounts.getPlugin(ledgerA).getInfo = this.accounts.getPlugin(ledgerB).getInfo = function () {
      return {
        currencyCode: 'doesn\'t matter, the connector will ignore this',
        currencyScale: 2
      }
    }

    this.clock = sinon.useFakeTimers(START_DATE)

    await this.accounts.connect()
  })

  afterEach(async function () {
    this.clock.restore()
    process.env = cloneDeep(env)
  })

  describe('getDestinationTransfer', function () {
    it('returns the original destination transfer when the connector can settle it', async function () {
      const { destinationAccount, destinationTransfer } = await this.routeBuilder.getDestinationTransfer(ledgerA, {
        amount: '100',
        ilp: packet.serializeIlpPayment({
          account: bobB,
          amount: '50'
        }),
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: (new Date(START_DATE + 2000)).toISOString(),
        custom: { }
      })
      assert.equal(destinationAccount, ledgerB)
      assert.deepEqual(destinationTransfer, {
        amount: '50',
        ilp: packet.serializeIlpPayment({
          account: bobB,
          amount: '50'
        }),
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: (new Date(START_DATE + 1000)).toISOString(),
        custom: { }
      })
    })

    it('passes on the ILP packet', async function () {
      const ilp = packet.serializeIlpForwardedPayment({
        account: bobB
      })
      const { destinationAccount, destinationTransfer } = await this.routeBuilder.getDestinationTransfer(ledgerA, {
        amount: '100',
        ilp,
        data: Buffer.from('ababab', 'hex'),
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: (new Date(START_DATE + 2000)).toISOString(),
        custom: { ilpLegacyAmount: '50' }
      })
      assert.equal(destinationAccount, ledgerB)
      assert.deepEqual(destinationTransfer.ilp, ilp)
    })

    it('uses best rate when packet is a forwarded payment', async function () {
      const ilp = packet.serializeIlpForwardedPayment({
        account: bobB
      })
      const { destinationAccount, destinationTransfer } = await this.routeBuilder.getDestinationTransfer(ledgerA, {
        amount: '100',
        ilp,
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: (new Date(START_DATE + 2000)).toISOString()
      })
      assert.equal(destinationAccount, ledgerB)
      assert.deepEqual(destinationTransfer.amount, '50')
      assert.deepEqual(destinationTransfer.ilp, ilp)
    })

    it('throws "Insufficient Source Amount" when the amount is too low', async function () {
      await assert.isRejected(this.routeBuilder.getDestinationTransfer(ledgerA, {
        amount: '97',
        ilp: packet.serializeIlpPayment({
          account: bobB,
          amount: '50'
        })
      }), InterledgerRejectionError, 'Payment rate does not match the rate currently offered')
    })

    describe('with a route from ledgerB → ledgerC', function () {
      beforeEach(async function () {
        const points = [ [0, 0], [200, 100] ]
        this.routingTable.insert(ledgerC, ledgerB)
        this.quoter.cacheCurve({
          prefix: ledgerC,
          curve: new LiquidityCurve(points),
          expiry: START_DATE + 45000,
          minMessageWindow: 1
        })
      })

      it('returns an intermediate destination transfer when the connector knows a route to the destination', async function () {
        const { destinationAccount, destinationTransfer } = await this.routeBuilder.getDestinationTransfer(ledgerA, {
          amount: '100',
          ilp: packet.serializeIlpPayment({
            account: carlC,
            amount: '25'
          }),
          executionCondition: 'yes',
          expiresAt: '2015-06-16T00:00:02.000Z',
          custom: {
            cancellationCondition: 'no'
          }
        })
        assert.equal(destinationAccount, ledgerB)
        assert.deepEqual(destinationTransfer, {
          amount: '50',
          ilp: packet.serializeIlpPayment({
            account: carlC,
            amount: '25'
          }),
          executionCondition: 'yes',
          expiresAt: '2015-06-16T00:00:01.000Z',
          custom: {
            cancellationCondition: 'no'
          }
        })
      })
    })

    it('throws when there is no path from the source to the destination', async function () {
      await assert.isRejected(this.routeBuilder.getDestinationTransfer(ledgerA, {
        amount: '100',
        ilp: packet.serializeIlpPayment({
          account: carlC,
          amount: '50'
        })
      }), 'no route found. source=usd-ledger destination=cny-ledger.carl')
    })

    it('throws when the source transfer has no destination', async function () {
      await assert.isRejected(this.routeBuilder.getDestinationTransfer(ledgerA, {
        amount: '100',
        ilp: packet.serializeIlpForwardedPayment({
          account: ''
        }),
        data: {}
      }), InterledgerRejectionError, 'missing destination.')
    })
  })
})
