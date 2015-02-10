'use strict';

// Node 0.10 Promise polyfill
if (!global.Promise) global.Promise = require('bluebird');

var settlements = require('./controllers/settlements');
var compress = require('koa-compress');
var logger = require('koa-logger');
var serve = require('koa-static');
var route = require('koa-route');
var errorHandler = require('./middlewares/error-handler');
var koa = require('koa');
var path = require('path');
var log = require('./services/log');
var config = require('./services/config');
var app = module.exports = koa();

// Logger
app.use(logger({ reporter: log('koa') }));
// app.use(logger());
app.use(errorHandler);

app.use(route.get('/v1/settlements/:id', settlements.fetch));
app.use(route.post('/v1/settlements', settlements.create));

// Serve static files
app.use(serve(path.join(__dirname, 'public')));

// Compress
app.use(compress());

if (!module.parent) {
  app.listen(config.server.port);
  log('app').info('listening on port '+config.server.port);
}
