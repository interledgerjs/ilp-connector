'use strict'

const _ = require('lodash')
const co = require('co')
const metadata = require('./controllers/metadata')
const health = require('./controllers/health')
const pairs = require('./controllers/pairs')
const quote = require('./controllers/quote')
const routes = require('./controllers/routes')
const notifications = require('./controllers/notifications')
const subscriptions = require('./models/subscriptions')
const compress = require('koa-compress')
const serve = require('koa-static')
const route = require('koa-route')
const errorHandler = require('five-bells-shared/middlewares/error-handler')
const koa = require('koa')
const path = require('path')
const logger = require('koa-bunyan-logger')
const Passport = require('koa-passport').KoaPassport
const cors = require('koa-cors')
const log = require('./common/log')

function listen (koaApp, config, ledgers, backend, routeBuilder, routeBroadcaster) {
  if (config.getIn(['server', 'secure'])) {
    const spdy = require('spdy')
    const tls = config.get('tls')

    const options = {
      port: config.getIn(['server', 'port']),
      host: config.getIn(['server', 'bind_ip']),
      key: tls.key,
      cert: tls.cert,
      ca: tls.ca,
      crl: tls.crl,
      requestCert: config.getIn(['auth', 'client_certificates_enabled']),

      // Certificates are checked in the passport-client-cert middleware
      // Authorization check is disabled here to allow clients to connect
      // to some endpoints without presenting client certificates, or using a
      // different authentication method (e.g., Basic Auth)
      rejectUnauthorized: false
    }

    spdy.createServer(
      options, koaApp.callback()).listen(config.getIn(['server', 'port']))
  } else {
    koaApp.listen(config.getIn(['server', 'port']))
  }

  log.info('connector listening on ' + config.getIn(['server', 'bind_ip']) + ':' +
    config.getIn(['server', 'port']))
  log.info('public at ' + config.getIn(['server', 'base_uri']))
  for (let pair of config.get('tradingPairs')) {
    log.info('pair', pair)
  }

  // Start a coroutine that connects to the backend and
  // subscribes to all the ledgers in the background
  co(function * () {
    try {
      yield backend.connect()
    } catch (error) {
      log.error(error)
      process.exit(1)
    }
    yield subscriptions.subscribePairs(config.get('tradingPairs'), ledgers, config, routeBuilder)
    yield routeBroadcaster.start()
  }).catch((err) => log.error(err))
}

function createApp (config, ledgers, backend, routeBuilder, routeBroadcaster, routingTables, infoCache, balanceCache) {
  const koaApp = koa()

  if (!config) {
    config = require('./services/config')
  }

  if (!ledgers) {
    ledgers = require('./services/ledgers')
  }

  if (!backend) {
    backend = require('./services/backend')
  }

  if (!routeBuilder) {
    routeBuilder = require('./services/route-builder')
  }

  if (!routeBroadcaster) {
    routeBroadcaster = require('./services/route-broadcaster')
  }

  if (!routingTables) {
    routingTables = require('./services/routing-tables')
  }

  if (!infoCache) {
    infoCache = require('./services/info-cache')
  }

  if (!balanceCache) {
    balanceCache = require('./services/balance-cache')
  }

  koaApp.context.config = config
  koaApp.context.ledgers = ledgers
  koaApp.context.backend = backend
  koaApp.context.routeBuilder = routeBuilder
  koaApp.context.routeBroadcaster = routeBroadcaster
  koaApp.context.routingTables = routingTables
  koaApp.context.infoCache = infoCache
  koaApp.context.balanceCache = balanceCache

  // Configure passport
  const passport = new Passport()
  require('./services/auth')(passport, config)

  // Logger
  koaApp.use(logger(log.create('koa')))
  koaApp.use(logger.requestIdContext())

  const isTrace = log.trace()
  koaApp.use(logger.requestLogger({
    updateRequestLogFields: function (fields) {
      return {
        headers: this.req.headers,
        body: isTrace ? this.body : undefined,
        query: this.query
      }
    },
    updateResponseLogFields: function (fields) {
      return {
        duration: fields.duration,
        status: this.status,
        headers: this.headers,
        body: isTrace ? this.body : undefined
      }
    }
  }))
  koaApp.use(errorHandler({log: log.create('error-handler')}))
  koaApp.on('error', function () {})

  koaApp.use(passport.initialize())
  koaApp.use(cors({expose: ['link']}))

  koaApp.use(route.get('/', metadata.getResource))
  koaApp.use(route.get('/health', health.getResource))
  koaApp.use(route.get('/pairs', pairs.getCollection))

  koaApp.use(route.get('/quote', quote.get))
  koaApp.use(route.post('/routes', routes.post))

  koaApp.use(route.post('/notifications', notifications.post))

  // Serve static files
  koaApp.use(serve(path.join(__dirname, 'public')))

  // Compress
  koaApp.use(compress())

  return {
    koaApp: koaApp,
    listen: _.partial(listen, koaApp, config, ledgers, backend, routeBuilder, routeBroadcaster),
    callback: koaApp.callback.bind(koaApp)
  }
}

module.exports = createApp
