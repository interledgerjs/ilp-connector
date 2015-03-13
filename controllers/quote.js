'use strict';

const config = require('../services/config');
const log = require('../services/log')('quote');

exports.get = function *() {
  const pair = [
    this.query.source_asset + '/' + this.query.source_ledger,
    this.query.destination_asset + '/' + this.query.destination_ledger
  ];

  const rate = config.rates[pair.join(':')];

  let sourceAmount, destinationAmount;
  if (this.query.source_amount) {
    log.debug('creating quote with fixed source amount');
    sourceAmount = this.query.source_amount;
    destinationAmount = String(this.query.source_amount / rate);
  } else if (this.query.destination_amount) {
    log.debug('creating quote with fixed destination amount');
    sourceAmount = String(this.query.destination_amount * rate);
    destinationAmount = this.query.destination_amount;
  } else {
    // XXX
    throw new Error();
  }

  let source_transfer = {
    source_funds: [{
      ledger: this.query.source_ledger,
      asset: this.query.source_asset
    }],
    destination_funds: [{
      ledger: this.query.source_ledger,
      asset: this.query.source_asset,
      amount: sourceAmount,
      account: config.id
    }]
  };

  let destination_transfer = {
    source_funds: [{
      account: config.id,
      ledger: this.query.destination_ledger,
      asset: this.query.destination_asset,
      amount: destinationAmount
    }],
    destination_funds: [{
      ledger: this.query.destination_ledger,
      asset: this.query.destination_asset
    }]
  };

  log.debug('' + source_transfer.destination_funds[0].amount + ' ' +
            source_transfer.destination_funds[0].asset + ' => ' +
            destination_transfer.source_funds[0].amount + ' ' +
            destination_transfer.source_funds[0].asset);

  this.body = {
    source_transfer: source_transfer,
    destination_transfer: destination_transfer
  };
};
