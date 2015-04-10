'use strict';

const config = require('../services/config');
const log = require('five-bells-shared/services/log')('quote');
const fxRates = require('../services/fxRates');

function formatAmount (amount) {
  if (typeof amount === 'string') {
    amount = parseFloat(amount);
  }
  return amount.toFixed(2);
}

exports.get = function *() {
  // TODO: make sure the currency pair is one we trade

  let rate = yield fxRates.get(this.query.source_asset,
    this.query.destination_asset);
  rate = rate.toFixed(5);
  // TODO: fix rounding and make a sensible
  // policy for limiting the smallest units
  log.debug('FX Rate for ' + this.query.source_asset +
    ' => ' + this.query.destination_asset + ':', rate);

  let sourceAmount, destinationAmount;
  if (this.query.source_amount) {
    log.debug('creating quote with fixed source amount');
    sourceAmount = formatAmount(this.query.source_amount);
    destinationAmount = formatAmount(this.query.source_amount * rate);
  } else if (this.query.destination_amount) {
    log.debug('creating quote with fixed destination amount');
    sourceAmount = formatAmount(this.query.destination_amount / rate);
    destinationAmount = formatAmount(this.query.destination_amount);
  } else {
    // XXX
    throw new Error();
  }

  let source_transfer = {
    credits: [{
      ledger: this.query.source_ledger,
      asset: this.query.source_asset,
      amount: sourceAmount,
      account: config.id
    }]
  };

  let destination_transfer = {
    debits: [{
      account: config.id,
      ledger: this.query.destination_ledger,
      asset: this.query.destination_asset,
      amount: destinationAmount
    }]
  };

  log.debug('' + source_transfer.credits[0].amount + ' ' +
            source_transfer.credits[0].asset + ' => ' +
            destination_transfer.debits[0].amount + ' ' +
            destination_transfer.debits[0].asset);

  this.body = {
    source_transfer: source_transfer,
    destination_transfer: destination_transfer
  };
};
