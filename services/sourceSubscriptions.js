'use strict'

const records = {}

exports.put = function (sourceTransferId, payment) {
  records[sourceTransferId] = payment
}

exports.get = function (sourceTransferId) {
  return records[sourceTransferId]
}

exports.remove = function (sourceTransferId) {
  delete records[sourceTransferId]
}

exports.hasPayment = function (payment) {
  for (let sourceTransfer of payment.source_transfers) {
    if (records[sourceTransfer.id]) {
      return true
    }
  }
  return false
}
