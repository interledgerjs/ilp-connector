'use strict'

const _ = require('lodash')
const co = require('co')
const metadata = require('./controllers/metadata')
const health = require('./controllers/health')
const pairs = require('./controllers/pairs')
const quote = require('./controllers/quote')
const routes = require('./controllers/routes')
const subscriptions = require('./models/subscriptions')
const compress = require('koa-compress')
const serve = require('koa-static')
const route = require('koa-route')
const errorHandler = require('five-bells-shared/middlewares/error-handler')
const koa = require('koa')
const path = require('path')
const logger = require('koa-bunyan-logger')
const Passport = require('koa-passport').KoaPassport
const ilpCore = require('ilp-core')
const cors = require('koa-cors')
const log = require('./common/log')

const loadConfig = require('./lib/config')
const makeCore = require('./lib/core')
const RoutingTables = require('./lib/routing-tables')
const TradingPairs = require('./lib/trading-pairs')
const RouteBuilder = require('./lib/route-builder')
const RouteBroadcaster = require('./lib/route-broadcaster')
const InfoCache = require('./lib/info-cache')
const BalanceCache = require('./lib/balance-cache')

function listen (koaApp, config, core, backend, routeBuilder, routeBroadcaster, tradingPairs) {
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
  for (let pair of tradingPairs.toArray()) {
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
    yield subscriptions.subscribePairs(tradingPairs.toArray(), core, config, routeBuilder)
    if (config.routeBroadcastEnabled) {
      yield routeBroadcaster.start()
    } else {
      yield routeBroadcaster.reloadLocalRoutes()
    }
  }).catch((err) => log.error(err))
}

function addPlugin (config, core, backend, routeBroadcaster, tradingPairs, id, options, tradesTo, tradesFrom) {
  return co(function * () {
    core.addClient(id, new ilpCore.Client(Object.assign({}, options.options, {
      connector: config.server.base_uri,
      _plugin: require(options.plugin),
      _log: log.create(options.plugin)
    })))

    yield core.getClient(id).connect()

    if (tradesTo) {
      tradingPairs.addPairs(tradesTo.map((e) => [options.currency + '@' + id, e]))
    }

    if (tradesFrom) {
      tradingPairs.addPairs(tradesTo.map((e) => [e, options.currency + '@' + id]))
    }

    if (!tradesFrom && !tradesTo) {
      tradingPairs.addAll(options.currency + '@' + id)
    }

    yield routeBroadcaster.reloadLocalRoutes()
  })
}

function removePlugin (config, core, backend, routingTables, tradingPairs, id) {
  return co(function * () {
    tradingPairs.removeAll(id)
    routingTables.removeLedger(id)

    yield core.getClient(id).disconnect()
    delete core.clients[id]
  })
}

function createApp (config, core, backend, routeBuilder, routeBroadcaster, routingTables, tradingPairs, infoCache, balanceCache) {
  const koaApp = koa()

  if (!config) {
    config = loadConfig()
  }

  if (!routingTables) {
    routingTables = new RoutingTables({
      baseURI: config.server.base_uri,
      backend: config.backend,
      expiryDuration: config.routeExpiry,
      fxSpread: config.fxSpread,
      slippage: config.slippage
    })
  }

  if (!core) {
    core = makeCore({config, log, routingTables})
  }

  if (!tradingPairs) {
    tradingPairs = new TradingPairs(config.get('tradingPairs'))
  }

  if (!backend) {
    const Backend = require('./backends/' + config.get('backend'))
    if (!Backend) {
      throw new Error('Backend not found. The backend ' +
        'module specified by CONNECTOR_BACKEND was not found in /backends')
    }

    backend = new Backend({
      currencyWithLedgerPairs: tradingPairs,
      backendUri: config.get('backendUri'),
      spread: config.get('fxSpread'),
      infoCache: infoCache
    })
  }

  if (!infoCache) {
    infoCache = new InfoCache(core)
  }

  if (!routeBuilder) {
    routeBuilder = new RouteBuilder(
      routingTables,
      infoCache,
      core,
      {
        minMessageWindow: config.expiry.minMessageWindow,
        slippage: config.slippage
      }
    )
  }

  if (!routeBroadcaster) {
    routeBroadcaster = new RouteBroadcaster(
      routingTables,
      backend,
      core,
      infoCache,
      {
        tradingPairs: tradingPairs,
        minMessageWindow: config.expiry.minMessageWindow,
        routeBroadcastEnabled: config.routeBroadcastEnabled,
        routeCleanupInterval: config.routeCleanupInterval,
        routeBroadcastInterval: config.routeBroadcastInterval,
        autoloadPeers: config.autoloadPeers,
        peers: config.peers
      }
    )
  }

  if (!balanceCache) {
    balanceCache = new BalanceCache(core)
  }

  koaApp.context.config = config
  koaApp.context.core = core
  koaApp.context.backend = backend
  koaApp.context.routeBuilder = routeBuilder
  koaApp.context.routeBroadcaster = routeBroadcaster
  koaApp.context.routingTables = routingTables
  koaApp.context.tradingPairs = tradingPairs
  koaApp.context.infoCache = infoCache
  koaApp.context.balanceCache = balanceCache

  // Configure passport
  const passport = new Passport()
  require('./lib/auth')(passport, config)

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

  // Serve static files
  koaApp.use(serve(path.join(__dirname, 'public')))

  // Compress
  koaApp.use(compress())

  return {
    koaApp: koaApp,
    listen: _.partial(listen, koaApp, config, core, backend, routeBuilder, routeBroadcaster, tradingPairs),
    callback: koaApp.callback.bind(koaApp),
    addPlugin: _.partial(addPlugin, config, core, backend, routeBroadcaster, tradingPairs),
    removePlugin: _.partial(removePlugin, config, core, backend, routingTables, tradingPairs)
  }
}

module.exports = createApp
