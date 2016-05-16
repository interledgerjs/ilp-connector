'use strict'

const FiveBellsLedger = require('./five-bells-ledger')
const healthStatus = require('../../common/health.js')

function Multiledger (options) {
  this.config = options.config
  this.log = options.log
  this.ledger_types = {undefined: FiveBellsLedger}
  this.ledgers = this.buildLedgers()
  this.ledgersHealth = { ledgersHealth: healthStatus.statusNotOk }
}

Multiledger.prototype.addLedger = function (Ledger) {
  this.ledger_types[Ledger.TYPE] = Ledger
}

Multiledger.prototype.getLedger = function (ledgerId) {
  return this.ledgers[ledgerId]
}

Multiledger.prototype.buildLedgers = function () {
  const ledgers = {}
  Object.keys(this.config.get('ledgerCredentials')).forEach((ledgerId) => {
    let creds = this.config.getIn(['ledgerCredentials', ledgerId])
    let Ledger = this.ledger_types[creds.type]
    ledgers[ledgerId] = new Ledger({
      ledger_id: ledgerId,
      credentials: creds,
      log: this.log(Ledger.name),
      config: this.config
    })
  })
  return ledgers
}

Multiledger.prototype.getType = function (ledgerId) {
  return this.getLedger(ledgerId).constructor.TYPE
}

Multiledger.prototype.checkLedgersHealth = function * () {
  this.ledgersHealth = { ledgersHealth: healthStatus.statusNotOk }
  yield Object.keys(this.ledgers).map((ledgerId) => this.ledgers[ledgerId].checkHealth())
  this.ledgersHealth = { ledgersHealth: healthStatus.statusOk }
}

Multiledger.prototype.getStatus = function () {
  return this.ledgersHealth
}

// /////////////////////////////////////////////////////////////////////////////
// Forward to the appropriate ledger
// /////////////////////////////////////////////////////////////////////////////

Multiledger.prototype.validateTransfer = function (transfer) {
  return this.getLedger(transfer.ledger).validateTransfer(transfer)
}

Multiledger.prototype.makeFundTemplate = function (ledger, template) {
  return this.getLedger(ledger).makeFundTemplate(template)
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
Multiledger.prototype.subscribe = function (ledgerId, listener) {
  let ledger = this.getLedger(ledgerId)
  return ledger.subscribe(listener)
}

module.exports = Multiledger
