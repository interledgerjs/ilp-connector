module.exports = handleError;

var log = require('../services/log')('error-handler');

var handlers = handleError.handlers = {
  InvalidBodyError: function (err) {
    log.warn('Invalid Body: '+err.message);
    this.status = 400;
    this.body = {
      id: "Invalid Body",
      message: err.message,
      validationErrors: err.validationErrors
    };
  },
  InvalidUriParameterError: function (err) {
    log.warn('Invalid URI parameter: '+err.message);
    this.status = 400;
    this.body = {
      id: "Invalid URI Parameter",
      message: err.message,
      validationErrors: err.validationErrors
    };
  },
  UnprocessableEntityError: function (err) {
    log.warn('Unprocessable: '+err.message);
    this.status = 422;
    this.body = {
      id: "Unprocessable Entity",
      message: err.message
    };
  },
  NotFoundError: function (err) {
    log.warn('Not Found: '+err.message);
    this.status = 404;
    this.body = {
      id: "Not Found",
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
      log.error(''+err);
      throw err;
    }
  }
};
