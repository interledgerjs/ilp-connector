'use strict'
const config = require('../../services/config')
const FiveBellsLedger = require('./five-bells-ledger')
const RippledLedger = require('./rippled-ledger')
const ledgers = {}

function getLedger (ledger_id) {
  return ledgers[ledger_id] ||
        (ledgers[ledger_id] = buildLedger(ledger_id))
}

function buildLedger (ledger_id) {
  let creds = config.ledgerCredentials[ledger_id]
  return creds.type === 'rippled'
       ? new RippledLedger(ledger_id, creds)
       : new FiveBellsLedger(ledger_id, creds)
}

exports.makeFundTemplate = function (ledger, template) {
  return getLedger(ledger).makeFundTemplate(template)
}

exports.getState = function (transfer) {
  return getLedger(transfer.ledger).getState(transfer)
}

exports.putTransfer = function (transfer) {
  return getLedger(transfer.ledger).putTransfer(transfer)
}

exports.subscribe = function (ledger, options) {
  return getLedger(ledger).subscribe(options)
}
