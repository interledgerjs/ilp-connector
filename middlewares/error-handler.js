'use strict';

module.exports = handleError;

const log = require('../services/log')('error-handler');

const handlers = handleError.handlers = {
  InvalidBodyError: function (err) {
    log.warn('Invalid Body: ' + err.message);
    this.status = 400;
    this.body = {
      id: err.name,
      message: err.message,
      validationErrors: err.validationErrors
    };
  },
  InvalidUriParameterError: function (err) {
    log.warn('Invalid URI parameter: ' + err.message);
    this.status = 400;
    this.body = {
      id: err.name,
      message: err.message,
      validationErrors: err.validationErrors
    };
  },
  UnprocessableEntityError: function (err) {
    log.warn('Unprocessable: ' + err.message);
    this.status = 422;
    this.body = {
      id: err.name,
      message: err.message
    };
  },
  NotFoundError: function (err) {
    log.warn('Not Found: '+err.message);
    this.status = 404;
    this.body = {
      id: err.name,
      message: err.message
    };
  },
  ExternalError: function (err) {
    log.warn('External Error: ' + err.message);
    this.status = 500;
    this.body = {
      id: err.name,
      message: err.message
    };
  }
}

function *handleError(next) {
  try {
    yield next;
  } catch (err) {
    if (handlers[err.constructor.name]) {
      handlers[err.constructor.name].call(this, err);
    } else {
      log.error(err ? err.stack : err);

      throw err;
    }
  }
};
