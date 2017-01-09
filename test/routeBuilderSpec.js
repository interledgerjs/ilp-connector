'use strict'

const assert = require('assert')
const RoutingTables = require('../src/lib/routing-tables')
const RouteBuilder = require('../src/lib/route-builder')
const appHelper = require('./helpers/app')
const logHelper = require('./helpers/log')
const logger = require('../src/common/log')
const Ledgers = require('../src/lib/ledgers')

const ledgerA = 'usd-ledger.'
const ledgerB = 'eur-ledger.'
const ledgerC = 'cny-ledger.'

// sending/receiving users
const aliceA = 'usd-ledger.alice'
const bobB = 'eur-ledger.bob'
const carlC = 'cny-ledger.carl'

// connector users
const markA = 'usd-ledger.mark'
const markB = 'eur-ledger.mark'
const maryB = 'eur-ledger.mary'

describe('RouteBuilder', function () {
  logHelper(logger)
  beforeEach(function * () {
    appHelper.create(this)

    this.tables = new RoutingTables({
      fxSpread: 0.002,
      slippage: 0.001
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
    this.ledgers.getPlugin(ledgerA).getInfo =
    this.ledgers.getPlugin(ledgerB).getInfo =
      function () { return {precision: 10, scale: 2} }

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

    this.builder = new RouteBuilder(this.tables, this.ledgers, {
      minMessageWindow: 1,
      slippage: 0.01
    })
    yield this.ledgers.connect()
  })

  describe('getQuote', function () {
    beforeEach(function * () {
      this.tables.addRoute({
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        source_account: maryB,
        min_message_window: 1,
        points: [ [0, 0], [200, 100] ]
      })
    })

    describe('fixed sourceAmount', function () {
      it('Local quote should return additional info', function * () {
        const quoteTransfer = yield this.builder.getQuote({
          sourceAddress: aliceA,
          destinationAddress: bobB,
          sourceAmount: '200',
          explain: 'true'
        })
        assert.deepStrictEqual(quoteTransfer, {
          connectorAccount: markA,
          sourceLedger: ledgerA,
          sourceAmount: '200.00',
          destinationLedger: ledgerB,
          destinationAmount: '99.00',
          sourceExpiryDuration: '6',
          destinationExpiryDuration: '5',
          additionalInfo: {
            rate_info: 'someInfoAboutTheRate',
            slippage: '1'
          },
          minMessageWindow: 1,
          nextLedger: ledgerB
        })
      })

      it('returns a quote with slippage in the final amount', function * () {
        const quoteTransfer = yield this.builder.getQuote({
          sourceAddress: aliceA,
          destinationAddress: carlC,
          sourceAmount: '100',
          explain: 'true'
        })
        assert.deepStrictEqual(quoteTransfer, {
          connectorAccount: markA,
          sourceLedger: ledgerA,
          sourceAmount: '100.00',
          destinationLedger: ledgerC,
          destinationAmount: '24.75',
          sourceExpiryDuration: '7',
          destinationExpiryDuration: '5',
          additionalInfo: { slippage: '0.25' },
          minMessageWindow: 2,
          nextLedger: ledgerB
        })
      })

      it('allows a specified slippage', function * () {
        const quoteTransfer = yield this.builder.getQuote({
          sourceAddress: aliceA,
          destinationAddress: carlC,
          sourceAmount: '100',
          slippage: '0.1',
          explain: 'true'
        })
        assert.deepStrictEqual(quoteTransfer, {
          connectorAccount: markA,
          sourceLedger: ledgerA,
          sourceAmount: '100.00',
          destinationLedger: ledgerC,
          destinationAmount: '22.5',
          sourceExpiryDuration: '7',
          destinationExpiryDuration: '5',
          additionalInfo: { slippage: '2.5' },
          minMessageWindow: 2,
          nextLedger: ledgerB
        })
      })
    })

    describe('fixed destinationAmount', function () {
      it('returns a quote with slippage in the source amount', function * () {
        const quoteTransfer = yield this.builder.getQuote({
          sourceAddress: aliceA,
          destinationAddress: carlC,
          destinationAmount: '25',
          explain: 'true'
        })
        assert.deepStrictEqual(quoteTransfer, {
          connectorAccount: markA,
          sourceLedger: ledgerA,
          sourceAmount: '101.00',
          destinationLedger: ledgerC,
          destinationAmount: '25',
          sourceExpiryDuration: '7',
          destinationExpiryDuration: '5',
          additionalInfo: { slippage: '-1' },
          minMessageWindow: 2,
          nextLedger: ledgerB
        })
      })

      it('throws if there is no path to the destination', function * () {
        yield assertThrows(function * () {
          yield this.builder.getQuote({
            sourceAddress: aliceA,
            destinationAddress: 'ledgerD.doraD',
            destinationAmount: '25'
          })
        }.bind(this), error('This connector does not support the given asset pair'))
      })
    })

    describe('route with precision/scale', function () {
      beforeEach(function * () {
        this.tables.removeLedger(ledgerC)
        this.tables.addRoute({
          source_ledger: ledgerB,
          destination_ledger: ledgerC,
          source_account: maryB,
          min_message_window: 1,
          points: [ [0, 0], [200, 100] ],
          destination_precision: 4,
          destination_scale: 0
        })
      })

      it('Local quote should return additional info', function * () {
        const quoteTransfer = yield this.builder.getQuote({
          sourceAddress: aliceA,
          destinationAddress: carlC,
          sourceAmount: '100',
          explain: 'true'
        })
        assert.deepStrictEqual(quoteTransfer, {
          connectorAccount: markA,
          sourceLedger: ledgerA,
          sourceAmount: '100.00',
          destinationLedger: ledgerC,
          destinationAmount: '24', // rounded from 24.75
          destinationPrecisionAndScale: {precision: 4, scale: 0},
          sourceExpiryDuration: '7',
          destinationExpiryDuration: '5',
          additionalInfo: { slippage: '0.25' },
          minMessageWindow: 2,
          nextLedger: ledgerB
        })
      })
    })
  })

  describe('getDestinationTransfer', function () {
    it('returns the original destination transfer when the connector can settle it', function * () {
      const destinationTransfer = yield this.builder.getDestinationTransfer({
        id: 'fd7ecefd-8eb8-4e16-b7c8-b67d9d6995f5',
        ledger: ledgerA,
        direction: 'incoming',
        account: aliceA,
        amount: '100',
        data: {
          ilp_header: {
            account: bobB,
            amount: '50'
          }
        }
      })
      assert.deepEqual(destinationTransfer, {
        id: 'd9600d94-f171-4443-83f5-c4c685fa70cd',
        ledger: ledgerB,
        direction: 'outgoing',
        account: bobB,
        amount: '50',
        noteToSelf: {
          source_transfer_id: 'fd7ecefd-8eb8-4e16-b7c8-b67d9d6995f5',
          source_transfer_ledger: ledgerA,
          source_transfer_amount: '100'
        },
        data: {
          ilp_header: {
            account: bobB,
            amount: '50'
          }
        }
      })
    })

    it('only overrides the trader debit account when it isnt already set', function * () {
      const destinationTransfer = yield this.builder.getDestinationTransfer({
        id: 'ce83ac53-3abb-47d3-b32d-37aa36dd6372',
        ledger: ledgerA,
        direction: 'incoming',
        account: aliceA,
        amount: '100',
        data: {
          ilp_header: {
            account: bobB,
            amount: '50'
          }
        }
      })
      assert.deepEqual(destinationTransfer, {
        id: '628cc7c4-4046-4815-897d-78895741efd9',
        ledger: ledgerB,
        direction: 'outgoing',
        account: bobB,
        amount: '50',
        noteToSelf: {
          source_transfer_id: 'ce83ac53-3abb-47d3-b32d-37aa36dd6372',
          source_transfer_ledger: ledgerA,
          source_transfer_amount: '100'
        },
        data: {
          ilp_header: {
            account: bobB,
            amount: '50'
          }
        }
      })
    })

    it('passes on the ilp_header', function * () {
      const destinationTransfer = yield this.builder.getDestinationTransfer({
        id: 'fd7ecefd-8eb8-4e16-b7c8-b67d9d6995f5',
        ledger: ledgerA,
        direction: 'incoming',
        account: aliceA,
        amount: '100',
        data: {
          ilp_header: {
            account: bobB,
            amount: '50'
          }
        }
      })
      assert.deepEqual(destinationTransfer.data, {
        ilp_header: {
          account: bobB,
          amount: '50'
        }
      })
    })

    describe('with a route from ledgerB → ledgerC', function () {
      beforeEach(function * () {
        this.tables.addRoute({
          source_ledger: ledgerB,
          destination_ledger: ledgerC,
          source_account: maryB,
          min_message_window: 1,
          points: [ [0, 0], [200, 100] ]
        })
      })

      it('returns an intermediate destination transfer when the connector knows a route to the destination', function * () {
        const destinationTransfer = yield this.builder.getDestinationTransfer({
          id: '123',
          ledger: ledgerA,
          direction: 'incoming',
          account: aliceA,
          amount: '100',
          data: {
            ilp_header: {
              account: carlC,
              amount: '25'
            }
          },
          executionCondition: 'yes',
          cancellationCondition: 'no',
          expiresAt: '2015-06-16T00:00:01.000Z'
        })
        assert.deepEqual(destinationTransfer, {
          id: destinationTransfer.id,
          ledger: ledgerB,
          direction: 'outgoing',
          account: maryB,
          amount: '50.00',
          data: {
            ilp_header: {
              account: carlC,
              amount: '25'
            }
          },
          noteToSelf: {
            source_transfer_id: '123',
            source_transfer_ledger: ledgerA,
            source_transfer_amount: '100'
          },
          executionCondition: 'yes',
          cancellationCondition: 'no',
          expiresAt: '2015-06-16T00:00:00.000Z'
        })
      })
    })

    it('throws when there is no path from the source to the destination', function * () {
      yield assertThrows(function * () {
        yield this.builder.getDestinationTransfer({
          id: '123',
          ledger: ledgerA,
          direction: 'incoming',
          account: aliceA,
          amount: '100',
          data: {
            ilp_header: {
              account: carlC,
              amount: '50'
            }
          }
        })
      }.bind(this), error('This connector does not support the given asset pair'))
    })

    it('throws when the source transfer has no destination transfer', function * () {
      yield assertThrows(function * () {
        yield this.builder.getDestinationTransfer({
          id: '123',
          ledger: ledgerA,
          account: aliceA,
          amount: '100',
          data: {}
        })
      }.bind(this), error('source transfer is missing ilp_header in memo'))
    })
  })
})

function * assertThrows (generator, validateError) {
  try {
    yield generator()
  } catch (err) {
    return validateError(err)
  }
  assert(false, 'expected function to throw')
}

function error (message) {
  return function (err) { return assert.equal(err.message, message) }
}
