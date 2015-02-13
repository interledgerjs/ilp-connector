'use strict';

var R = require('ramda');
var uuid = require('node-uuid');
var log = require('../services/log')('transfers');
var request = require('request-promise');
var req = require('../services/request');
var config = require('../services/config');
var UnprocessableEntityError = require('../errors/unprocessable-entity-error');
var NotFoundError = require('../errors/not-found-error');
var InvalidBodyError = require('../errors/invalid-body-error');

exports.fetch = function *fetch(id) {
  req.uri('id', id, 'Uuid');
  log.debug('fetching transfer ID '+id);

  this.body = yield db.get(['transfers', id]);
  if (!this.body) throw new NotFoundError('Unknown transfer ID');
};

exports.create = function *create() {
  var _this = this;
  var transfer = yield req.body(this, 'Transfer');

  log.debug('preparing transfer ID '+transfer.id);

  if (!transfer.source.ledger ||
      !transfer.source.currency ||
      !transfer.destination.ledger ||
      !transfer.destination.currency) {
    throw new InvalidBodyError('Source and destination currency and ledger need to be fully specified.');
  }

  var pair = [
    transfer.source.currency+'/'+transfer.source.ledger,
    transfer.destination.currency+'/'+transfer.destination.ledger,
  ];

  var rate = config.rates[pair.join(':')];

  if (!rate) {
    throw new UnprocessableEntityError('Not offering trades on the market for '+pair.join(':'));
  }

  if (transfer.source.amount) {
    log.debug('calculating quote for converting ' +
        transfer.source.amount + " " + transfer.source.currency +
        " to " +
        transfer.destination.currency);

      transfer.destination.amount = String(transfer.source.amount / rate);
  } else if (transfer.destination.amount) {
      log.debug('calculating quote for converting ' +
        transfer.source.currency +
        " to " +
        transfer.destination.amount + " " + transfer.destination.currency);

      transfer.source.amount = String(transfer.destination.amount * rate);
  } else {
    throw new InvalidBodyError('Either source or destination amount must be quantified.');
  }

  log.debug('transfer created');

  try {
    var destinationTransfer = {
      id: uuid.v4(),
      source: R.mixin(transfer.destination, { owner: config.id }),
      destination: transfer.destination
    };

    yield request.put({
      url: 'http://'+transfer.destination.ledger+'/v1/transfers/'+destinationTransfer.id,
      json: true,
      body: destinationTransfer
    });

    var sourceTransfer = {
      id: uuid.v4(),
      source: transfer.source,
      destination: R.mixin(transfer.source, { owner: config.id })
    };

    yield request.put({
      url: 'http://'+transfer.source.ledger+'/v1/transfers/'+sourceTransfer.id,
      json: true,
      body: sourceTransfer
    });
  } catch (err) {
    if (!(err instanceof Error)) {
      log.error('remote error: '+JSON.stringify(err, null, 2));
      throw new Error('Unable to execute transaction');
    }
  }

  log.debug('transfer executed');

  this.body = transfer;
};
