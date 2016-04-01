'use strict'

const _ = require('lodash')
const co = require('co')
const metadata = require('./controllers/metadata')
const health = require('./controllers/health')
const pairs = require('./controllers/pairs')
const quote = require('./controllers/quote')
const notifications = require('./controllers/notifications')
const subscriptions = require('./models/subscriptions')
const compress = require('koa-compress')
const serve = require('koa-static')
const route = require('koa-route')
const errorHandler = require('five-bells-shared/middlewares/error-handler')
const koa = require('koa')
const path = require('path')
const logger = require('koa-mag')
const Passport = require('koa-passport').KoaPassport
const cors = require('koa-cors')
const log = require('./common/log')
const backend = require('./services/backend')

function listen (koaApp, config, ledgers) {
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

  log('app').info('connector listening on ' + config.getIn(['server', 'bind_ip']) + ':' +
    config.getIn(['server', 'port']))
  log('app').info('public at ' + config.getIn(['server', 'base_uri']))
  for (let pair of config.get('tradingPairs')) {
    log('app').info('pair', pair)
  }

  // Start a coroutine that connects to the backend and
  // subscribes to all the ledgers in the background
  co(function * () {
    yield backend.connect()

    yield subscriptions.subscribePairs(config.get('tradingPairs'), ledgers, config)
  }).catch(function (err) {
    log('app').error(typeof err === 'object' && err.stack || err)
  })
}

function createApp (config, ledgers) {
  const koaApp = koa()

  koaApp.context.config = config
  koaApp.context.ledgers = ledgers

  // Configure passport
  const passport = new Passport()
  require('./services/auth')(passport, config)

  // Logger
  koaApp.use(logger())
  koaApp.use(errorHandler({log: log('error-handler')}))

  koaApp.use(passport.initialize())
  koaApp.use(cors({expose: ['link']}))

  koaApp.use(route.get('/', metadata.getResource))
  koaApp.use(route.get('/health', health.getResource))
  koaApp.use(route.get('/pairs', pairs.getCollection))

  koaApp.use(route.get('/quote', quote.get))
  koaApp.use(route.get('/quote_local', quote.getLocal))

  koaApp.use(route.post('/notifications', notifications.post))

  // Serve static files
  koaApp.use(serve(path.join(__dirname, 'public')))

  // Compress
  koaApp.use(compress())

  return {
    koaApp: koaApp,
    listen: _.partial(listen, koaApp, config, ledgers),
    callback: koaApp.callback.bind(koaApp)
  }
}

module.exports = createApp
