'use strict'

const co = require('co')
const defer = require('co-defer')
const koa = require('koa')
const koaRouter = require('koa-router')
const debug = require('debug')('ilp-connector:integration-test-server')
const log = require('../common').log.create('integration-test-server')
const SIMPLIFY_POINTS = 10

class IntegrationTestServer {
  /**
   * @param {Object} config
   * @param {Ledgers} ledgers
   * @param {Backend} backend

   */
  constructor (config, ledgers, backend, routeBuilder, routeBroadcaster, messageRouter) {
    this.testServerUri = config.integrationTestUri
    this.port = config.integrationTestPort
    this.config = config
    this.ledgers = ledgers
    this.backend = backend
    this.routeBuilder = routeBuilder
    this.routeBroadcaster = routeBroadcaster
    this.messageRouter = messageRouter
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
  listen() {
    const app = this.koaApp = koa()
    const router = this.koaRouter = new koaRouter()
    const routingTables = this.routeBroadcaster.routingTables
    const name = this.config.integrationTestName
    router.get('/',function*(next) {
      this.body = JSON.stringify({name: name})
    })
    router.get('/routes',function*(next) {
      debug('GET /routes')
      this.body = routingTables.toJSON(SIMPLIFY_POINTS)
    })
    app.use(router.middleware())
    app.use(router.routes())
    app.use(router.allowedMethods())
    app.listen(this.port)
  }
}

module.exports = IntegrationTestServer
