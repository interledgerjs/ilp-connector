'use strict';

module.exports = function InvalidUriParameterError(message, validationErrors) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = message;
  this.validationErrors = validationErrors;
};

require('util').inherits(module.exports, Error);
