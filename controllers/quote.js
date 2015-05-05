'use strict';

const config = require('../services/config');
const log = require('five-bells-shared/services/log')('quote');
const fxRates = require('../services/fxRates');
const NoAmountSpecifiedError = require('../errors/no-amount-specified-error');

function formatAmount (amount) {
  if (typeof amount === 'string') {
    amount = parseFloat(amount);
  }
  return amount.toFixed(2);
}

exports.get = function *() {

  let rate = yield fxRates.get(this.query.source_ledger,
    this.query.destination_ledger);
  rate = rate.toFixed(5);
  // TODO: fix rounding and make a sensible
  // policy for limiting the smallest units
  log.debug('FX Rate for ' + this.query.source_ledger +
    ' => ' + this.query.destination_ledger + ':', rate);

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
    throw new NoAmountSpecifiedError('Must specify either source ' +
      'or destination amount to get quote');
  }

  let settlementTemplate = {
    source_transfers: [{
      ledger: this.query.source_ledger,
      credits: [{
        account: config.id,
        amount: sourceAmount
      }]
    }],
    destination_transfers: [{
      ledger: this.query.destination_ledger,
      debits: [{
        account: config.id,
        amount: destinationAmount
      }]
    }]
  };

  log.debug('' + sourceAmount + ' ' +
            this.query.source_ledger + ' => ' +
            destinationAmount + ' ' +
            this.query.destination_ledger);

  this.body = settlementTemplate;
};
