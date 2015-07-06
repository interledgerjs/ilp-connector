'use strict';

const url = require('url');

const config = exports;

exports.id = process.env.TRADER_ID || 'mark';

config.server = {};
config.server.secure = !!process.env.PUBLIC_HTTPS;
config.server.bind_ip = process.env.BIND_IP || '0.0.0.0';
config.server.port = process.env.PORT || 4000;
config.server.public_host = process.env.HOSTNAME || require('os').hostname();
config.server.public_port = process.env.PUBLIC_PORT || config.server.port;

// Currency pairs traded should be specified as
// [["USD@http://usd-ledger.example/USD","EUR@http://eur-ledger.example"],...]
config.tradingPairs = JSON.parse(process.env.TRADING_PAIRS || '[]');

// Credentials should be specified as a map of the form
// {
//    "<ledger_uri>": {
//      "username": "...",
//      "password": "..."
//    }
// }
config.ledgerCredentials = JSON.parse(process.env.TRADER_CREDENTIALS || '{}');

config.features = {};
config.features.debugAutoFund = !!process.env.TRADER_DEBUG_AUTOFUND;

// If the fxRatesApi is changed, make sure to change the tests
// because another feed will likely have a different data format
config.fx = {};
config.fx.ratesApi = process.env.TRADER_FX_API || 'http://api.fixer.io/latest';
config.fx.ratesCacheTtl = process.env.TRADER_FX_CACHE_TTL || 24 * 3600000;
config.fx.spread = process.env.TRADER_FX_SPREAD || 0.002;

config.expiry = {};
config.expiry.minMessageWindow =
  process.env.MIN_MESSAGE_WINDOW || 1; // seconds
config.expiry.maxHoldTime = process.env.MAX_HOLD_TIME || 10; // seconds
config.expiry.rejectionCreditPercentage =
  process.env.REJECTION_CREDIT_PERCENTAGE || 0.01;

const isCustomPort = config.server.secure ?
  +config.server.public_port !== 443 : +config.server.public_port !== 80;
config.server.base_uri = url.format({
  protocol: 'http' + (config.server.secure ? 's' : ''),
  hostname: config.server.public_host,
  port: isCustomPort ? config.server.public_port : undefined
});

if (process.env.NODE_ENV === 'unit') {
  config.server.base_uri = 'http://localhost';
  config.ledgerCredentials = {
    "http://eur-ledger.example/EUR": {
      username: 'mark',
      password: 'mark'
    },
    "http://cny-ledger.example/CNY": {
      username: 'mark',
      password: 'mark'
    }
  }
}
