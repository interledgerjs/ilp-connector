'use strict'

const chai = require('chai')
const assert = chai.assert
const packet = require('ilp-packet')
const RoutingTables = require('../src/lib/routing-tables')
const RouteBuilder = require('../src/lib/route-builder')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../src/common/log')
const Ledgers = require('../src/lib/ledgers')
const Quoter = require('../src/lib/quoter')
const InterledgerRejectionError = require('../src/errors/interledger-rejection-error')

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

const ledgerA = 'usd-ledger.'
const ledgerB = 'eur-ledger.'
const ledgerC = 'cny-ledger.'

// sending/receiving users
const bobB = 'eur-ledger.bob'
const carlC = 'cny-ledger.carl'

// connector users
const markA = 'usd-ledger.mark'
const markB = 'eur-ledger.mark'
const maryB = 'eur-ledger.mary'

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

describe('RouteBuilder', function () {
  logHelper(logger)
  beforeEach(async function () {
    appHelper.create(this)

    this.tables = new RoutingTables({
      fxSpread: 0.002,
      slippage: 0.02
    })

    const ledgerCredentials = {}
    ledgerCredentials[ledgerA] = {
      currency: 'USD',
      plugin: 'ilp-plugin-mock',
      options: {}
    }
    ledgerCredentials[ledgerB] = {
      currency: 'USD',
      plugin: 'ilp-plugin-mock',
      options: {}
    }
    this.ledgers = new Ledgers({
      config: {
        server: {},
        features: {}
      },
      log: logger,
      routingTables: this.tables
    })
    this.ledgers.addFromCredentialsConfig(ledgerCredentials)
    this.ledgers.getPlugin(ledgerA).getInfo = this.ledgers.getPlugin(ledgerB).getInfo = function () {
      return {
        currencyCode: 'doesn\'t matter, the connector will ignore this',
        currencyScale: 2
      }
    }

    this.tables.addLocalRoutes(this.ledgers, [{
      source_ledger: ledgerA,
      destination_ledger: ledgerB,
      source_account: markA,
      destination_account: markB,
      min_message_window: 1,
      points: [ [0, 0], [200, 100] ],
      additional_info: { rate_info: 'someInfoAboutTheRate' }
    }])

    this.ledgers.getPlugin(ledgerA).getAccount = function () { return markA }
    this.ledgers.getPlugin(ledgerB).getAccount = function () { return markB }

    this.quoter = new Quoter(this.ledgers, this.config)

    this.builder = new RouteBuilder(this.ledgers, this.quoter, {
      minMessageWindow: 1,
      maxHoldTime: 10,
      slippage: 0.02,
      secret: Buffer.from('VafuntVJRw6YzDTs4IgIU1IPJACywtgUUQJHh1u018w=', 'base64')
    })
    await this.ledgers.connect()
  })

  describe('getDestinationTransfer', function () {
    it('returns the original destination transfer when the connector can settle it', async function () {
      const { destinationLedger, destinationTransfer } = await this.builder.getDestinationTransfer(ledgerA, {
        amount: '100',
        ilp: packet.serializeIlpPayment({
          account: bobB,
          amount: '50'
        }),
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: (new Date(START_DATE + 1000)).toISOString(),
        custom: { }
      })
      assert.equal(destinationLedger, ledgerB)
      assert.deepEqual(destinationTransfer, {
        amount: '50',
        ilp: packet.serializeIlpPayment({
          account: bobB,
          amount: '50'
        }),
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: (new Date(START_DATE)).toISOString(),
        custom: { }
      })
    })

    it('passes on the ILP packet', async function () {
      const ilp = packet.serializeIlpForwardedPayment({
        account: bobB
      })
      const { destinationLedger, destinationTransfer } = await this.builder.getDestinationTransfer(ledgerA, {
        amount: '100',
        ilp,
        data: Buffer.from('ababab', 'hex'),
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: (new Date(START_DATE + 1000)).toISOString(),
        custom: { ilpLegacyAmount: '50' }
      })
      assert.equal(destinationLedger, ledgerB)
      assert.deepEqual(destinationTransfer.ilp, ilp)
    })

    it('uses best rate when packet is a forwarded payment', async function () {
      const ilp = packet.serializeIlpForwardedPayment({
        account: bobB
      })
      const { destinationLedger, destinationTransfer } = await this.builder.getDestinationTransfer(ledgerA, {
        amount: '100',
        ilp,
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: (new Date(START_DATE + 1000)).toISOString()
      })
      assert.equal(destinationLedger, ledgerB)
      assert.deepEqual(destinationTransfer.amount, '50')
      assert.deepEqual(destinationTransfer.ilp, ilp)
    })

    it('throws "Insufficient Source Amount" when the amount is too low', async function () {
      await assert.isRejected(this.builder.getDestinationTransfer(ledgerA, {
        amount: '97',
        ilp: packet.serializeIlpPayment({
          account: bobB,
          amount: '50'
        })
      }), InterledgerRejectionError, 'Payment rate does not match the rate currently offered')
    })

    it('returns a destination transfer when the amount is too low, but within the slippage', async function () {
      const ilp = packet.serializeIlpPayment({
        account: bobB,
        amount: '50'
      })
      const { destinationTransfer } = await this.builder.getDestinationTransfer(ledgerA, {
        amount: '99', // 99  * (1 - slippage) = 100 ⇒ 50
        ilp,
        executionCondition: Buffer.from('I3TZF5S3n0-07JWH0s8ArsxPmVP6s-0d0SqxR6C3Ifk', 'base64'),
        expiresAt: (new Date(START_DATE + 1000)).toISOString()
      })
      assert.equal(destinationTransfer.ilp, ilp)
      assert.equal(destinationTransfer.amount, '50')
    })

    describe('with a route from ledgerB → ledgerC', function () {
      beforeEach(async function () {
        const points = [ [0, 0], [200, 100] ]
        this.tables.addRoute({
          source_ledger: ledgerB,
          destination_ledger: ledgerC,
          source_account: maryB,
          min_message_window: 1,
          points
        })
      })

      it('returns an intermediate destination transfer when the connector knows a route to the destination', async function () {
        const { destinationLedger, destinationTransfer } = await this.builder.getDestinationTransfer(ledgerA, {
          amount: '100',
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
        assert.equal(destinationLedger, ledgerB)
        assert.deepEqual(destinationTransfer, {
          amount: '50',
          ilp: packet.serializeIlpPayment({
            account: carlC,
            amount: '25'
          }),
          executionCondition: 'yes',
          expiresAt: '2015-06-16T00:00:00.000Z',
          custom: {
            cancellationCondition: 'no'
          }
        })
      })
    })

    it('throws when there is no path from the source to the destination', async function () {
      await assert.isRejected(this.builder.getDestinationTransfer(ledgerA, {
        amount: '100',
        ilp: packet.serializeIlpPayment({
          account: carlC,
          amount: '50'
        })
      }), 'No route found from: usd-ledger. to: cny-ledger.carl')
    })

    it('throws when the source transfer has no destination', async function () {
      await assert.isRejected(this.builder.getDestinationTransfer(ledgerA, {
        amount: '100',
        ilp: packet.serializeIlpForwardedPayment({
          account: ''
        }),
        data: {}
      }), InterledgerRejectionError, 'Missing destination')
    })
  })
})
