var path = require('path');

exports.id = 'mark';

exports.server = {};
exports.server.port = process.env.PORT || 4000;

exports.rates = {};

if (process.env.NODE_ENV === 'test') {
  exports.rates["USD/localhost:3001:EUR/localhost:3002"] =     1.2;
  exports.rates["EUR/localhost:3002:USD/localhost:3001"] = 1 / 1.2;
}
