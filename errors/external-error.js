'use strict';

module.exports = function ExternalError(message) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = message;
};

require('util').inherits(module.exports, Error);

module.exports.prototype.handler = function *(ctx, log) {
  log.warn('External Error: ' + this.message);
  ctx.status = 502;
  ctx.body = {
    id: this.name,
    message: this.message,
    owner: this.accountIdentifier
  };
};
