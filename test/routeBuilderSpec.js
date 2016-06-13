'use strict'

const assert = require('assert')
const RoutingTables = require('five-bells-routing').RoutingTables
const RouteBuilder = require('five-bells-connector')._test.RouteBuilder

const baseURI = 'http://mark.example'
const ledgerA = 'http://usd-ledger.example'
const ledgerB = 'http://eur-ledger.example'
const ledgerC = 'http://cny-ledger.example'

// sending/receiving users
const aliceA = 'http://usd-ledger.example/accounts/alice'
const bobB = 'http://eur-ledger.example/accounts/bob'
const carlC = 'http://cny-ledger.example/accounts/carl'

// connector users
const markA = 'http://usd-ledger.example/accounts/mark'
const markB = 'http://eur-ledger.example/accounts/mark'
const maryB = 'http://eur-ledger.example/accounts/mary'

describe('RouteBuilder', function () {
  beforeEach(function * () {
    this.infoCache = {
      get: function * (ledger) {
        return {precision: 10, scale: 2}
      }
    }

    this.tables = new RoutingTables(baseURI, [{
      source_ledger: ledgerA,
      destination_ledger: ledgerB,
      connector: 'http://mark.example',
      source_account: markA,
      destination_account: markB,
      min_message_window: 1,
      points: [ [0, 0], [200, 100] ],
      additional_info: { rate_info: 'someInfoAboutTheRate' }
    }])
    this.builder = new RouteBuilder(this.tables, this.infoCache, this.ledgers, {
      minMessageWindow: 1,
      slippage: 0.01
    })
  })

  describe('getQuote', function () {
    beforeEach(function * () {
      this.tables.addRoute({
        source_ledger: ledgerB,
        destination_ledger: ledgerC,
        connector: 'http://mary.example',
        source_account: maryB,
        min_message_window: 1,
        points: [ [0, 0], [200, 100] ]
      })
    })

    describe('fixed sourceAmount', function () {
      it('Local quote should return additional info', function * () {
        const quoteTransfer = yield this.builder.getQuote({
          sourceLedger: ledgerA,
          sourceAccount: aliceA,
          destinationLedger: ledgerB,
          destinationAccount: bobB,
          sourceAmount: '200',
          explain: 'true'
        })
        assert.deepStrictEqual(quoteTransfer, {
          source_connector_account: markA,
          source_ledger: ledgerA,
          source_amount: '200.00',
          destination_ledger: ledgerB,
          destination_amount: '99.00',
          _hop: quoteTransfer._hop,
          additional_info: { rate_info: 'someInfoAboutTheRate',
                             slippage: '1' }
        })
      })
    })

    describe('fixed sourceAmount', function () {
      it('returns a quote with slippage in the final amount', function * () {
        const quoteTransfer = yield this.builder.getQuote({
          sourceLedger: ledgerA,
          sourceAccount: aliceA,
          destinationLedger: ledgerC,
          destinationAccount: carlC,
          sourceAmount: '100',
          explain: 'true'
        })
        assert.deepStrictEqual(quoteTransfer, {
          source_connector_account: markA,
          source_ledger: ledgerA,
          source_amount: '100.00',
          destination_ledger: ledgerC,
          destination_amount: '24.75',
          _hop: quoteTransfer._hop,
          additional_info: { slippage: '0.25' }
        })
      })
    })

    describe('fixed destinationAmount', function () {
      it('returns a quote with slippage in the source amount', function * () {
        const quoteTransfer = yield this.builder.getQuote({
          sourceLedger: ledgerA,
          sourceAccount: aliceA,
          destinationLedger: ledgerC,
          destinationAccount: carlC,
          destinationAmount: '25',
          explain: 'true'
        })
        assert.deepStrictEqual(quoteTransfer, {
          source_connector_account: markA,
          source_ledger: ledgerA,
          source_amount: '101.00',
          destination_ledger: ledgerC,
          destination_amount: '25.00',
          _hop: quoteTransfer._hop,
          additional_info: { slippage: '-1' }
        })
      })

      it('throws if there is no path to the destination', function * () {
        const ledgerD = 'http://ledgerD.example'
        yield assertThrows(function * () {
          yield this.builder.getQuote({
            sourceLedger: ledgerA,
            sourceAccount: aliceA,
            destinationLedger: ledgerD,
            destinationAccount: ledgerD + '/accounts/doraD',
            destinationAmount: '25'
          })
        }.bind(this), error('This connector does not support the given asset pair'))
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
            ledger: ledgerB,
            account: bobB,
            amount: '50'
          }
        }
      })
      assert.deepEqual(destinationTransfer, {
        id: 'c88dc516-ad0e-4a48-85ac-9dd08b3e72f3',
        ledger: ledgerB,
        direction: 'outgoing',
        account: bobB,
        amount: '50',
        noteToSelf: {
          source_transfer_id: 'fd7ecefd-8eb8-4e16-b7c8-b67d9d6995f5',
          source_transfer_ledger: ledgerA
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
            ledger: ledgerB,
            account: bobB,
            amount: '50'
          }
        }
      })
      assert.deepEqual(destinationTransfer, {
        id: '13eff292-b343-452d-8fc4-4833741a6186',
        ledger: ledgerB,
        direction: 'outgoing',
        account: bobB,
        amount: '50',
        noteToSelf: {
          source_transfer_id: 'ce83ac53-3abb-47d3-b32d-37aa36dd6372',
          source_transfer_ledger: ledgerA
        }
      })
    })

    describe('with a route from ledgerB → ledgerC', function () {
      beforeEach(function * () {
        this.tables.addRoute({
          source_ledger: ledgerB,
          destination_ledger: ledgerC,
          connector: 'http://mary.example',
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
              ledger: ledgerC,
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
              ledger: ledgerC,
              account: carlC,
              amount: '25'
            }
          },
          noteToSelf: {
            source_transfer_id: '123',
            source_transfer_ledger: ledgerA
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
              ledger: ledgerC,
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
