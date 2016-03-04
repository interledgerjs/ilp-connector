'use strict'

const assert = require('assert')
const SettlementQueue = require('five-bells-connector')._test.SettlementQueue
const sinon = require('sinon')
const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

describe('SettlementQueue', function () {
  beforeEach(function () {
    this.clock = sinon.useFakeTimers(START_DATE)
    this.queue = new SettlementQueue({expiry: {maxHoldTime: 10}})
    this.records = this.queue.records
  })

  describe('storeTransfer', function () {
    const preparedTransfer = {id: 'foo', state: 'prepared'}

    it('stores a "prepared" transfer', function () {
      assert.equal(this.queue.storeTransfer(preparedTransfer), undefined)
      assert.deepEqual(this.records.foo, {
        transfer: preparedTransfer,
        payment: null,
        created_at: START_DATE
      })
    })

    it('stores a "executed" transfer', function () {
      const transfer = {id: 'foo', state: 'executed'}
      assert.equal(this.queue.storeTransfer(transfer), undefined)
      assert.deepEqual(this.records.foo, {
        transfer: transfer,
        payment: null,
        created_at: START_DATE
      })
    })

    it('deletes a "rejected" transfer', function () {
      const rejectedTransfer = {id: 'foo', state: 'rejected'}
      this.queue.storeTransfer(preparedTransfer)
      this.queue.storeTransfer(rejectedTransfer)
      assert.deepEqual(this.records, {})
    })
  })

  describe('storePayment', function () {
    const payment = {
      id: 'foo',
      source_transfers: [{id: 'bar', state: 'prepared'}]
    }

    it('stores the payment for each source transfers', function () {
      assert.equal(this.queue.storePayment(payment), undefined)
      assert.deepEqual(this.records, {
        bar: {transfer: null, payment: payment, created_at: START_DATE}
      })
    })
  })

  describe('storePayment + storeTransfer', function () {
    const payment = {
      id: 'foo',
      source_transfers: [
        {id: 'transfer1', state: 'proposed'},
        {id: 'transfer2', state: 'proposed'}
      ]
    }
    const transfer1 = {id: 'transfer1', state: 'prepared'}
    const transfer2 = {id: 'transfer2', state: 'prepared'}

    it('returns the trusted payment when the payment arrives last', function () {
      assert.equal(this.queue.storeTransfer(transfer1), undefined)
      assert.equal(this.queue.storeTransfer(transfer2), undefined)
      assert.deepEqual(this.queue.storePayment(payment), {
        id: 'foo',
        source_transfers: [transfer1, transfer2]
      })
      assert.deepEqual(this.records, {
        transfer1: { payment: payment, transfer: transfer1, created_at: START_DATE },
        transfer2: { payment: payment, transfer: transfer2, created_at: START_DATE }
      })
    })

    it('returns the trusted payment when a transfer arrives last', function () {
      assert.equal(this.queue.storeTransfer(transfer1), undefined)
      assert.equal(this.queue.storePayment(payment), undefined)
      assert.deepEqual(this.queue.storeTransfer(transfer2), {
        id: 'foo',
        source_transfers: [transfer1, transfer2]
      })
    })
  })

  describe('hasPaymentForTransfer', function () {
    const payment = {
      id: 'foo',
      source_transfers: [{id: 'bar', state: 'proposed'}]
    }
    const transfer = {id: 'bar', state: 'prepared'}

    it('returns true when it has the payment', function () {
      this.queue.storeTransfer(transfer)
      this.queue.storePayment(payment)
      assert.equal(this.queue.hasPaymentForTransfer(transfer.id), true)
    })

    it('returns false when it doesn\'t have the payment', function () {
      this.queue.storeTransfer(transfer)
      assert.equal(this.queue.hasPaymentForTransfer(transfer.id), false)
    })
  })

  describe('removePayment', function () {
    const payment = {
      id: 'foo',
      source_transfers: [
        {id: 'transfer1', state: 'proposed'},
        {id: 'transfer2', state: 'proposed'}
      ]
    }
    const transfer1 = {id: 'transfer1', state: 'prepared'}
    const transfer2 = {id: 'transfer2', state: 'prepared'}

    it('removes all corresponding transfers', function () {
      this.queue.storeTransfer(transfer1)
      this.queue.storeTransfer(transfer2)
      this.queue.storePayment(payment)
      this.queue.removePayment(payment)
      assert.deepEqual(this.records, {})
    })
  })

  describe('prune', function () {
    const transfer = {id: 'foo', state: 'prepared'}

    it('ignores non-expired transfers', function () {
      this.queue.storeTransfer(transfer)
      this.clock.tick(9999)
      this.queue.prune()
      assert.deepEqual(this.records, {
        foo: {
          transfer: transfer,
          payment: null,
          created_at: START_DATE
        }
      })
    })

    it('deletes expired transfers', function () {
      this.queue.storeTransfer(transfer)
      this.clock.tick(10001)
      this.queue.prune()
      assert.deepEqual(this.records, {})
    })
  })
})
