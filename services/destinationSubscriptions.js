'use strict'

const records = {}

exports.put = function (destinationTransferId, sourceTransfer) {
  records[destinationTransferId] = sourceTransfer
}

exports.get = function (destinationTransferId) {
  return records[destinationTransferId]
}

exports.remove = function (destinationTransferId) {
  delete records[destinationTransferId]
}
