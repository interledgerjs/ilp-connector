'use strict'
const EventEmitter = require('events')
const inherits = require('util').inherits
const PriorityQueue = require('priorityqueuejs')
const utils = require('./utils')

// Events:
//   expire([Transfer])
function TransferPool () {
  this.transferQueue = new PriorityQueue(byDate)
  this.transfersByID = {} // { transfer_id : Transfer }
  this.now = 0 // last ledger close time
  this.interval = setInterval(this._checkExpiries.bind(this), 1000)
  this.interval.unref()
}

inherits(TransferPool, EventEmitter)

TransferPool.prototype.insert = function (transfer) {
  this.transfersByID[transfer.id] = transfer
  let expires = transfer.expires_at
  if (expires) {
    this.transferQueue.enq({
      date: (new Date(expires)).getTime(),
      item: transfer
    })
  }
}

TransferPool.prototype.remove = function (transfer) {
  delete this.transfersByID[transfer.id]
  // Don't remove from transferQueue, it will just be ignored in _checkExpiries.
}

TransferPool.prototype.findByTransaction = function (transaction) {
  return this.transfersByID[utils.transactionToTransferID(transaction)]
}

TransferPool.prototype._checkExpiries = function () {
  let transfers = this.transferQueue
  let expired = []
  let now = this.now
  while (!transfers.isEmpty()) {
    let transfer = transfers.peek()
    if (transfer.item.state === 'executed') {
      this.remove(transfers.deq().item)
    } else if (transfer.date < now) {
      expired.push(transfers.deq())
      this.remove(transfer.item)
    } else {
      break
    }
  }
  if (expired.length) {
    this.emit('expire', expired)
  }
}

TransferPool.prototype.setTime = function (now) { this.now = now }

function byDate (a, b) {
  return b.date - a.date
}

module.exports = TransferPool
