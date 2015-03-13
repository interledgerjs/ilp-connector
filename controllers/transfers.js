'use strict';

var R = require('ramda');
var uuid = require('node-uuid');
var log = require('../services/log')('transfers');
var request = require('request-promise');
var req = require('../utils/request');
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

  if (!transfer.source_funds.ledger ||
      !transfer.source_funds.asset ||
      !transfer.destination_funds.ledger ||
      !transfer.destination_funds.asset) {
    throw new InvalidBodyError('Source and destination currency and ledger need to be fully specified.');
  }

  var pair = [
    transfer.source_funds.asset+'/'+transfer.source_funds.ledger,
    transfer.destination_funds.asset+'/'+transfer.destination_funds.ledger,
  ];

  var rate = config.rates[pair.join(':')];

  if (!rate) {
    throw new UnprocessableEntityError('Not offering trades on the market for '+pair.join(':'));
  }

  if (transfer.source_funds.amount) {
    log.debug('calculating quote for converting ' +
        transfer.source_funds.amount + " " + transfer.source_funds.asset +
        " to " +
        transfer.destination_funds.asset);

      transfer.destination_funds.amount = String(transfer.source_funds.amount / rate);
  } else if (transfer.destination_funds.amount) {
      log.debug('calculating quote for converting ' +
        transfer.source_funds.asset +
        " to " +
        transfer.destination_funds.amount + " " + transfer.destination_funds.asset);

      transfer.source_funds.amount = String(transfer.destination_funds.amount * rate);
  } else {
    throw new InvalidBodyError('Either source or destination amount must be quantified.');
  }

  log.debug('transfer created');

  try {
    var destinationTransfer = {
      id: uuid.v4(),
      source: R.mixin(transfer.destination_funds, { account: config.id }),
      destination: transfer.destination_funds
    };

    yield request.put({
      url: 'http://'+transfer.destination_funds.ledger+'/transfers/'+destinationTransfer.id,
      json: true,
      body: destinationTransfer
    });

    var sourceTransfer = {
      id: uuid.v4(),
      source: transfer.source_funds,
      destination: R.mixin(transfer.source_funds, { account: config.id })
    };

    yield request.put({
      url: 'http://'+transfer.source_funds.ledger+'/transfers/'+sourceTransfer.id,
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
