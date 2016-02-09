'use strict'

const FiveBellsLedger = require('./five-bells-ledger')

function Multiledger (options) {
  this.config = options.config
  this.log = options.log
  this.sourceSubscriptions = options.sourceSubscriptions
  this.ledger_types = {undefined: FiveBellsLedger}
  this.ledgers = {}
}

Multiledger.prototype.addLedger = function (Ledger) {
  this.ledger_types[Ledger.TYPE] = Ledger
}

Multiledger.prototype.getLedger = function (ledger_id) {
  return this.ledgers[ledger_id] ||
        (this.ledgers[ledger_id] = this.buildLedger(ledger_id))
}

Multiledger.prototype.validatePayment = function (payment) {
  let transfers = payment.source_transfers.concat(payment.destination_transfers)
  for (let transfer of transfers) {
    let result = this.validateTransfer(transfer)
    if (!result.valid) {
      return result
    }
  }
  return {valid: true, errors: []}
}

Multiledger.prototype.buildLedger = function (ledger_id) {
  let creds = this.config.getIn(['ledgerCredentials', ledger_id]).toJS()
  let Ledger = this.ledger_types[creds.type]
  return new Ledger({
    ledger_id: ledger_id,
    credentials: creds,
    log: this.log(Ledger.name),
    sourceSubscriptions: this.sourceSubscriptions
  })
}

Multiledger.prototype.getType = function (ledger_id) {
  return this.getLedger(ledger_id).constructor.TYPE
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

Multiledger.prototype.putTransferFulfillment = function (transfer, fulfillment) {
  return this.getLedger(transfer.ledger).putTransferFulfillment(transfer, fulfillment)
}

// target - {uri, transfer}
Multiledger.prototype.subscribe = function (ledger_id, target) {
  let ledger = this.getLedger(ledger_id)
  if (ledger instanceof FiveBellsLedger) {
    return ledger.subscribe(target.uri)
  } else {
    return ledger.subscribe(target.transfer)
  }
}

module.exports = Multiledger
