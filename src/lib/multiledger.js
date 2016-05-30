'use strict'

const _ = require('lodash')
const FiveBellsLedger = require('../ledgers/five-bells-ledger')
const healthStatus = require('../common/health.js')

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

Multiledger.prototype.getLedgers = function () {
  return _.clone(this.ledgers)
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

Multiledger.prototype.getStatus = function () {
  return _.every(this.ledgers, (ledger) => ledger.isConnected())
}

module.exports = Multiledger
