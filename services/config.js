'use strict';

const url = require('url');

const config = exports;

config.id = 'mark';

config.server = {};
config.server.secure = false;
config.server.bind_ip = process.env.BIND_IP || '0.0.0.0';
config.server.port = process.env.PORT || 4000;
config.server.public_host = process.env.HOSTNAME || require('os').hostname();
config.server.public_port = process.env.PUBLIC_PORT || config.server.port;

config.rates = {};

if (process.env.NODE_ENV === 'test') {
  config.rates['USD/localhost:3001;EUR/localhost:3002'] = 1.2;
  config.rates['EUR/localhost:3002;USD/localhost:3001'] = 1 / 1.2;
}

const isCustomPort = config.server.secure ?
  +config.server.public_port !== 443 : +config.server.public_port !== 80;
config.server.base_uri = url.format({
  protocol: 'http' + (config.server.secure ? 's' : ''),
  hostname: config.server.public_host,
  port: isCustomPort ? config.server.public_port : undefined
});
