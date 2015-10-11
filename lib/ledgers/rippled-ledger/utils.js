'use strict'
const _ = require('lodash')
const sjclcodec = require('sjcl-codec')

exports.setTransferState = function (transfer, state) {
  transfer.state = state
  transfer.timeline = transfer.timeline || {}
  transfer.timeline[state + '_at'] = (new Date()).toISOString()
}

exports.transactionToTransferID = function (transaction) {
  // transaction.Memos :: [ { Memo : {MemoType, MemoFormat, MemoData} } ]
  let memos = _.map(
    _.map(transaction.Memos || [], 'Memo'),
    decodeMemo)
  let memo = _.find(memos, 'MemoType', 'transfer_id')
  return memo && memo.MemoData
}

exports.hexToString = hexToString

function hexToString (hexString) {
  const bits = sjclcodec.hex.toBits(hexString)
  return sjclcodec.utf8String.fromBits(bits)
}

function decodeMemo (hexMemo) {
  return _.mapValues(hexMemo, hexToString)
}
