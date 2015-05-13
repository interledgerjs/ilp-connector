'use strict';

const config = require('../services/config');
const log = require('five-bells-shared/services/log')('quote');
const fxRates = require('../services/fxRates');
const NoAmountSpecifiedError = require('../errors/no-amount-specified-error');
const UnacceptableExpiryError = require('../errors/unacceptable-expiry-error');
const formatAmount = require('../utils/formatAmount');
const formatAmountCeil = require('../utils/formatAmountCeil');

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
    sourceAmount = formatAmountCeil(this.query.source_amount);
    destinationAmount = formatAmount(this.query.source_amount * rate);
  } else if (this.query.destination_amount) {
    log.debug('creating quote with fixed destination amount');
    sourceAmount = formatAmountCeil(this.query.destination_amount / rate);
    destinationAmount = formatAmount(this.query.destination_amount);
  } else {
    throw new NoAmountSpecifiedError('Must specify either source ' +
      'or destination amount to get quote');
  }

  let destinationExpiryDuration =
    parseFloat(this.query.destination_expiry_duration);
  let sourceExpiryDuration =
    parseFloat(this.query.source_expiry_duration);

  // Check destination_expiry_duration
  if (destinationExpiryDuration) {
    if (destinationExpiryDuration > config.expiry.maxHoldTime) {
      throw new UnacceptableExpiryError('Destination expiry duration ' +
        'is too long');
    }
  } else if (sourceExpiryDuration) {
    destinationExpiryDuration = sourceExpiryDuration
      - config.expiry.minMessageWindow;
  } else {
    destinationExpiryDuration = config.expiry.maxHoldTime;
  }

  // Check difference between destination_expiry_duration
  // and source_expiry_duration
  if (sourceExpiryDuration) {
    if (sourceExpiryDuration - destinationExpiryDuration
        < config.expiry.minMessageWindow) {
      throw new UnacceptableExpiryError('The difference between the ' +
        'destination expiry duration and the source expiry duration ' +
        'is insufficient to ensure that we can execute the ' +
        'source transfers');
    }
  } else {
    sourceExpiryDuration = destinationExpiryDuration +
      config.expiry.minMessageWindow;
  }

  let settlementTemplate = {
    source_transfers: [{
      ledger: this.query.source_ledger,
      credits: [{
        account: config.id,
        amount: sourceAmount
      }],
      expiry_duration: String(sourceExpiryDuration)
    }],
    destination_transfers: [{
      ledger: this.query.destination_ledger,
      debits: [{
        account: config.id,
        amount: destinationAmount
      }],
      expiry_duration: String(destinationExpiryDuration)
    }]
  };

  log.debug('' + sourceAmount + ' ' +
            this.query.source_ledger + ' => ' +
            destinationAmount + ' ' +
            this.query.destination_ledger);

  this.body = settlementTemplate;
};
