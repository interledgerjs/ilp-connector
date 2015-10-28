'use strict'
const config = require('../../services/config')
const FiveBellsLedger = require('./five-bells-ledger')
const log = require('../../services/log')
const sourceSubscriptions = require('../../services/sourceSubscriptions')

const ledger_types = {'': FiveBellsLedger}
const ledgers = {}

exports.addLedger = function (ledger_type, Ledger) {
  ledger_types[ledger_type] = Ledger
}

function getLedger (ledger_id) {
  return ledgers[ledger_id] ||
        (ledgers[ledger_id] = buildLedger(ledger_id))
}

function buildLedger (ledger_id) {
  let creds = config.ledgerCredentials[ledger_id]
  let Ledger = ledger_types[creds.type || '']
  return new Ledger({
    ledger_id: ledger_id,
    credentials: creds,
    log: log(Ledger.name),
    sourceSubscriptions: sourceSubscriptions
  })
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

exports.subscribe = function (ledger, target_uri) {
  return getLedger(ledger).subscribe(target_uri)
}
