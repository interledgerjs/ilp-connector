'use strict'

const records = {}

exports.put = function (sourceTransferId, settlement) {
  records[sourceTransferId] = settlement
}

exports.get = function (sourceTransferId) {
  return records[sourceTransferId]
}

exports.remove = function (destinationTransferId) {
  delete records[destinationTransferId]
}

exports.hasSettlement = function (settlement) {
  for (let sourceTransfer of settlement.source_transfers) {
    if (records[sourceTransfer.id]) {
      return true
    }
  }
  return false
}
