'use strict';

const url = require('url');

const config = exports;

exports.id = process.env.TRADER_ID || 'mark';

config.server = {};
config.server.secure = false;
config.server.bind_ip = process.env.BIND_IP || '0.0.0.0';
config.server.port = process.env.PORT || 4000;
config.server.public_host = process.env.HOSTNAME || require('os').hostname();
config.server.public_port = process.env.PUBLIC_PORT || config.server.port;

// Currency pairs traded should be specified as
// USD/ledger.us;EUR/ledger.eu,EUR/ledger.eu;USD/ledger.us
config.tradingPairs = (process.env.TRADING_PAIRS || '').split(',');

const isCustomPort = config.server.secure ?
  +config.server.public_port !== 443 : +config.server.public_port !== 80;
config.server.base_uri = url.format({
  protocol: 'http' + (config.server.secure ? 's' : ''),
  hostname: config.server.public_host,
  port: isCustomPort ? config.server.public_port : undefined
});
