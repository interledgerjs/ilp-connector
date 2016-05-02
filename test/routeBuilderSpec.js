'use strict'

const assert = require('assert')
const RoutingTables = require('five-bells-connector')._test.RoutingTables
const RouteBuilder = require('five-bells-connector')._test.RouteBuilder

const baseURI = 'http://mark.example'
const ledgerA = 'http://ledgerA.example'
const ledgerB = 'http://ledgerB.example'
const ledgerC = 'http://ledgerC.example'

// sending/receiving users
const aliceA = 'http://ledgerA.example/accounts/alice'
const bobB = 'http://ledgerB.example/accounts/bob'
const carlC = 'http://ledgerC.example/accounts/carl'

// connector users
const markA = 'http://ledgerA.example/accounts/mark'
const markB = 'http://ledgerB.example/accounts/mark'
const maryB = 'http://ledgerB.example/accounts/mary'

describe('RouteBuilder', function () {
  beforeEach(function * () {
    this.precisionCache = {
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
      points: [ [0, 0], [200, 100] ]
    }])
    this.builder = new RouteBuilder(this.tables, this.precisionCache, {
      minMessageWindow: 1,
      slippage: 0.01,
      ledgerCredentials: {
        'http://ledgerA.example': {account_uri: markA},
        'http://ledgerB.example': {account_uri: markB}
      }
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
      it('returns a quote with slippage in the final amount', function * () {
        const quoteTransfer = yield this.builder.getQuote({
          sourceLedger: ledgerA,
          sourceAccount: aliceA,
          destinationLedger: ledgerC,
          destinationAccount: carlC,
          sourceAmount: '100'
        })
        assert.deepStrictEqual(quoteTransfer, {
          ledger: ledgerA,
          debits: [{ account: aliceA, amount: '100.00' }],
          credits: [{
            account: markA,
            amount: '100.00',
            memo: {
              destination_transfer: {
                ledger: ledgerC,
                debits: [{ account: null, amount: '24.75' }],
                credits: [{ account: carlC, amount: '24.75' }]
              }
            }
          }],
          _hop: quoteTransfer._hop
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
          destinationAmount: '25'
        })
        assert.deepStrictEqual(quoteTransfer, {
          ledger: ledgerA,
          debits: [{ account: aliceA, amount: '101.00' }],
          credits: [{
            account: markA,
            amount: '101.00',
            memo: {
              destination_transfer: {
                ledger: ledgerC,
                debits: [{ account: null, amount: '25.00' }],
                credits: [{ account: carlC, amount: '25.00' }]
              }
            }
          }],
          _hop: quoteTransfer._hop
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
        id: '123',
        ledger: ledgerA,
        debits: [{account: aliceA, amount: '100'}],
        credits: [{
          account: markA,
          amount: '100',
          memo: {
            destination_transfer: {
              id: '456',
              ledger: ledgerB,
              debits: [{account: null, amount: '50'}],
              credits: [{account: bobB, amount: '50'}]
            }
          }
        }]
      })
      assert.deepEqual(destinationTransfer, {
        id: '456',
        ledger: ledgerB,
        debits: [{account: markB, amount: '50'}],
        credits: [{account: bobB, amount: '50'}]
      })
    })

    it('only overrides the trader debit account when it isnt already set', function * () {
      const destinationTransfer = yield this.builder.getDestinationTransfer({
        id: '123',
        ledger: ledgerA,
        debits: [{account: aliceA, amount: '100'}],
        credits: [{
          account: markA,
          amount: '100',
          memo: {
            destination_transfer: {
              id: '456',
              ledger: ledgerB,
              debits: [{account: ledgerB + '/accounts/bogus', amount: '50'}],
              credits: [{account: bobB, amount: '50'}]
            }
          }
        }]
      })
      assert.deepEqual(destinationTransfer, {
        id: '456',
        ledger: ledgerB,
        debits: [{account: ledgerB + '/accounts/bogus', amount: '50'}],
        credits: [{account: bobB, amount: '50'}]
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
          debits: [{account: aliceA, amount: '100'}],
          credits: [{
            account: markA,
            amount: '100',
            memo: {
              destination_transfer: {
                id: '456',
                ledger: ledgerC,
                debits: [{account: null, amount: '25'}],
                credits: [{account: carlC, amount: '25'}]
              }
            }
          }],
          execution_condition: 'yes',
          cancellation_condition: 'no',
          expires_at: '2015-06-16T00:00:01.000Z'
        })
        assert.deepEqual(destinationTransfer, {
          id: destinationTransfer.id,
          ledger: ledgerB,
          debits: [{account: markB, amount: '50.00'}],
          credits: [{
            account: maryB,
            amount: '50.00',
            memo: {
              destination_transfer: {
                id: '456',
                ledger: ledgerC,
                debits: [{account: null, amount: '25'}],
                credits: [{account: carlC, amount: '25'}]
              }
            }
          }],
          execution_condition: 'yes',
          cancellation_condition: 'no',
          expires_at: '2015-06-16T00:00:00.000Z'
        })
      })
    })

    it('throws when there is no path from the source to the destination', function * () {
      yield assertThrows(function * () {
        yield this.builder.getDestinationTransfer({
          id: '123',
          ledger: ledgerA,
          debits: [{account: aliceA, amount: '100'}],
          credits: [{
            account: markA,
            amount: '100',
            memo: {
              destination_transfer: {
                id: '456',
                ledger: ledgerC,
                debits: [{account: null, amount: '50'}],
                credits: [{account: carlC, amount: '50'}]
              }
            }
          }]
        })
      }.bind(this), error('This connector does not support the given asset pair'))
    })

    it('throws when the source transfer has no destination transfer', function * () {
      yield assertThrows(function * () {
        yield this.builder.getDestinationTransfer({
          id: '123',
          ledger: ledgerA,
          debits: [{account: aliceA, amount: '100'}],
          credits: [{account: markA, amount: '100'}]
        })
      }.bind(this), error('source transfer is missing destination_transfer in memo'))
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
