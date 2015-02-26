'use strict';

// Node 0.10 Promise polyfill
if (!global.Promise) global.Promise = require('bluebird');

var transfers = require('./controllers/transfers');
var compress = require('koa-compress');
var serve = require('koa-static');
var route = require('koa-route');
var errorHandler = require('./middlewares/error-handler');
var koa = require('koa');
var path = require('path');
var log = require('./services/log');
var logger = require('koa-mag');
var config = require('./services/config');
var app = module.exports = koa();

// Logger
app.use(logger());
app.use(errorHandler);

app.use(route.get('/transfers/:id', transfers.fetch));
app.use(route.put('/transfers/:uuid', transfers.create));

// Serve static files
app.use(serve(path.join(__dirname, 'public')));

// Compress
app.use(compress());

if (!module.parent) {
  app.listen(config.server.port);
  log('app').info('listening on port '+config.server.port);
}
