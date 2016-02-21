'use strict'

const health = require('./controllers/health')
const pairs = require('./controllers/pairs')
const quote = require('./controllers/quote')
const payments = require('./controllers/payments')
const notifications = require('./controllers/notifications')
const compress = require('koa-compress')
const serve = require('koa-static')
const route = require('koa-route')
const errorHandler = require('five-bells-shared/middlewares/error-handler')
const koa = require('koa')
const path = require('path')
const log = require('./services/log')
const logger = require('koa-mag')
const app = module.exports = koa()

// Logger
app.use(logger())
app.use(errorHandler({log: log('error-handler')}))

app.use(route.get('/health', health.getResource))
app.use(route.get('/pairs', pairs.getCollection))

app.use(route.put('/payments/:uuid', payments.put))

app.use(route.get('/quote', quote.get))

app.use(route.post('/notifications', notifications.post))

app.use(route.get('/', function *() {
  this.body = 'Hello, I am a 5 Bells connector'
}))

// Serve static files
app.use(serve(path.join(__dirname, 'public')))

// Compress
app.use(compress())
