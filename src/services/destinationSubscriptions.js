'use strict'

const _ = require('lodash')
const log = require('./log')('destinationSubscriptions')

const records = {}

exports.put = function (destinationTransferId, sourceTransfers) {
  records[destinationTransferId] = sourceTransfers
  log.debug('put subscription record: ' + destinationTransferId + ' -> ' + _.map(sourceTransfers, 'id'))
}

exports.get = function (destinationTransferId) {
  return records[destinationTransferId]
}

exports.remove = function (destinationTransferId) {
  delete records[destinationTransferId]
}
