'use strict'

const koa = require('koa')
const KoaRouter = require('koa-router')
const debug = require('debug')('ilp-connector:integration-test-server')
const SIMPLIFY_POINTS = 10

class IntegrationTestServer {
  /**
   * @param {Object} config
   * @param {Ledgers} ledgers
   * @param {Backend} backend
   * @param {RouteBuilder} routeBuilder
   * @param {RouteBroadcaster} routeBroadcaster
   * @param {MessageRouter} messageRouter
   * @param {IntegrationTestClient} integrationTestClient
   */
  constructor (config, ledgers, backend, routeBuilder, routeBroadcaster, messageRouter, integrationTestClient) {
    this.testServerUri = config.integrationTestUri
    this.port = config.integrationTestPort
    this.config = config
    this.ledgers = ledgers
    this.backend = backend
    this.routeBuilder = routeBuilder
    this.routeBroadcaster = routeBroadcaster
    this.messageRouter = messageRouter
    this.integrationTestClient = integrationTestClient
  }

  start () {
    try {
      this.listen()
    } catch (e) {
      if (e.name === 'SystemError' ||
          e.name === 'ServerError') {
        // System error, in that context that is a network error
        // This will be retried later, so do nothing
      } else {
        throw e
      }
    }
  }
  listen () {
    const app = this.koaApp = koa()
    const router = this.koaRouter = new KoaRouter()
    const routingTables = this.routeBroadcaster.routingTables
    const name = this.config.integrationTestName
    const itc = this.integrationTestClient
    router.get('/', function * (next) {
      this.body = JSON.stringify({name: name})
    })
    router.get('/routes', function * (next) {
      debug('GET /routes')
      this.body =
      { name: name,
        last_new_receive: itc.lastNewRouteReceivedAt,
        detected_stable_routing_table: (itc.roundsStable === -Infinity),
        routes: routingTables.toJSON(SIMPLIFY_POINTS)}
    })
    router.get('/message_log', function * (next) {
      debug('GET /message_log')
      this.body = JSON.stringify(itc.messageLog)
    })
    app.use(router.middleware())
    app.use(router.routes())
    app.use(router.allowedMethods())
    app.listen(this.port)
  }
}

module.exports = IntegrationTestServer
