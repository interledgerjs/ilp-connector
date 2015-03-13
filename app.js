'use strict';

const quote = require('./controllers/quote');
const transfers = require('./controllers/transfers');
const settlements = require('./controllers/settlements');
const compress = require('koa-compress');
const serve = require('koa-static');
const route = require('koa-route');
const errorHandler = require('./middlewares/error-handler');
const koa = require('koa');
const path = require('path');
const log = require('./services/log');
const logger = require('koa-mag');
const config = require('./services/config');
const app = module.exports = koa();

// Logger
app.use(logger());
app.use(errorHandler);

app.use(route.get('/transfers/:id', transfers.fetch));
app.use(route.put('/transfers/:uuid', transfers.create));

app.use(route.put('/settlements/:uuid', settlements.put));

app.use(route.get('/quote', quote.get));

// Serve static files
app.use(serve(path.join(__dirname, 'public')));

// Compress
app.use(compress());

if (!module.parent) {
  app.listen(config.server.port);
  log('app').info('listening on port ' + config.server.port);
}
