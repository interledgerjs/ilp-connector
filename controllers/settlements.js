'use strict';

var R = require('ramda');
var uuid = require('node-uuid');
var log = require('../services/log')('settlements');
var request = require('request-promise');
var req = require('../services/request');
var config = require('../services/config');
var UnprocessableEntityError = require('../errors/unprocessable-entity-error');
var NotFoundError = require('../errors/not-found-error');
var InvalidBodyError = require('../errors/invalid-body-error');

exports.fetch = function *fetch(id) {
  req.uri('id', id, 'Uuid');
  log.debug('fetching settlement ID '+id);

  this.body = yield db.get(['settlements', id]);
  if (!this.body) throw new NotFoundError('Unknown settlement ID');
};

exports.create = function *create() {
  var _this = this;
  var settlement = yield req.body(this, 'Settlement');

  // Generate a unique settlement ID outside of the transaction block
  settlement._id = uuid.v4();
  log.debug('preparing settlement ID '+settlement._id);

  if (!settlement.source.ledger ||
      !settlement.source.currency ||
      !settlement.destination.ledger ||
      !settlement.destination.currency) {
    throw new InvalidBodyError('Source and destination currency and ledger need to be fully specified.');
  }

  var pair = [
    settlement.source.currency+'/'+settlement.source.ledger,
    settlement.destination.currency+'/'+settlement.destination.ledger,
  ];

  var rate = config.rates[pair.join(':')];

  if (!rate) {
    throw new UnprocessableEntityError('Not offering trades on the market for '+pair.join(':'));
  }

  if (settlement.source.amount) {
    log.debug('calculating quote for converting ' +
        settlement.source.amount + " " + settlement.source.currency +
        " to " +
        settlement.destination.currency);

      settlement.destination.amount = String(settlement.source.amount / rate);
  } else if (settlement.destination.amount) {
      log.debug('calculating quote for converting ' +
        settlement.source.currency +
        " to " +
        settlement.destination.amount + " " + settlement.destination.currency);

      settlement.source.amount = String(settlement.destination.amount * rate);
  } else {
    throw new InvalidBodyError('Either source or destination amount must be quantified.');
  }

  log.debug('settlement created');

  try {
    yield request.post({
      url: 'http://'+settlement.destination.ledger+'/v1/transfers',
      json: true,
      body: {
        source: R.mixin(settlement.destination, { owner: config.id }),
        destination: settlement.destination
      }
    });

    yield request.post({
      url: 'http://'+settlement.source.ledger+'/v1/transfers',
      json: true,
      body: {
        source: settlement.source,
        destination: R.mixin(settlement.source, { owner: config.id })
      }
    });
  } catch (err) {
    if (!(err instanceof Error)) {
      log.error('remote error: '+JSON.stringify(err, null, 2));
      throw new Error('Unable to execute transaction');
    }
  }

  log.debug('settlement executed');

  this.body = settlement;
};
