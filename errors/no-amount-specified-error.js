'use strict';

module.exports = function NoAmountSpecifiedError(message) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = message;
};

require('util').inherits(module.exports, Error);

module.exports.prototype.handler = function *(ctx, log) {
  log.warn('No Amount Specified: ' + this.message);
  ctx.status = 400;
  ctx.body = {
    id: this.name,
    message: this.message
  };
};
