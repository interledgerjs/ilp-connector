'use strict'

const FiveBellsLedger = require('./five-bells-ledger')

function Multiledger (options) {
  this.config = options.config
  this.log = options.log
  this.ledger_types = {undefined: FiveBellsLedger}
  this.ledgers = {}
}

Multiledger.prototype.addLedger = function (Ledger) {
  this.ledger_types[Ledger.TYPE] = Ledger
}

Multiledger.prototype.getLedger = function (ledgerId) {
  return this.ledgers[ledgerId] ||
        (this.ledgers[ledgerId] = this.buildLedger(ledgerId))
}

Multiledger.prototype.buildLedger = function (ledgerId) {
  let creds = this.config.getIn(['ledgerCredentials', ledgerId])
  let Ledger = this.ledger_types[creds.type]
  return new Ledger({
    ledger_id: ledgerId,
    credentials: creds,
    log: this.log(Ledger.name),
    config: this.config
  })
}

Multiledger.prototype.getType = function (ledgerId) {
  return this.getLedger(ledgerId).constructor.TYPE
}

// /////////////////////////////////////////////////////////////////////////////
// Forward to the appropriate ledger
// /////////////////////////////////////////////////////////////////////////////

Multiledger.prototype.validateTransfer = function (transfer) {
  return this.ledger_types[transfer.type].validateTransfer(transfer)
}

Multiledger.prototype.makeFundTemplate = function (ledger, template) {
  return this.getLedger(ledger).makeFundTemplate(template)
}

Multiledger.prototype.getState = function (transfer) {
  return this.getLedger(transfer.ledger).getState(transfer)
}

Multiledger.prototype.putTransfer = function (transfer) {
  return this.getLedger(transfer.ledger).putTransfer(transfer)
}

Multiledger.prototype.putTransferFulfillment = function (ledgerID, transferID, fulfillment) {
  return this.getLedger(ledgerID).putTransferFulfillment(transferID, fulfillment)
}

Multiledger.prototype.getTransferFulfillment = function (transfer) {
  return this.getLedger(transfer.ledger).getTransferFulfillment(transfer)
}

// target - {uri, transfer}
Multiledger.prototype.subscribe = function (ledgerId, target) {
  let ledger = this.getLedger(ledgerId)
  if (ledger instanceof FiveBellsLedger) {
    return ledger.subscribe(target.uri)
  } else {
    return ledger.subscribe(target.transfer)
  }
}

module.exports = Multiledger
