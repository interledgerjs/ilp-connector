'use strict'

const metadata = require('./controllers/metadata')
const health = require('./controllers/health')
const pairs = require('./controllers/pairs')
const quote = require('./controllers/quote')
const notifications = require('./controllers/notifications')
const compress = require('koa-compress')
const serve = require('koa-static')
const route = require('koa-route')
const errorHandler = require('five-bells-shared/middlewares/error-handler')
const koa = require('koa')
const path = require('path')
const log = require('./services/log')
const logger = require('koa-mag')
const passport = require('koa-passport')
const app = module.exports = koa()

// Configure passport
require('./services/auth')

// Logger
app.use(logger())
app.use(errorHandler({log: log('error-handler')}))
app.use(passport.initialize())

app.use(route.get('/', metadata.getResource))
app.use(route.get('/health', health.getResource))
app.use(route.get('/pairs', pairs.getCollection))

app.use(route.get('/quote', quote.get))

app.use(route.post('/notifications', notifications.post))

// Serve static files
app.use(serve(path.join(__dirname, 'public')))

// Compress
app.use(compress())
