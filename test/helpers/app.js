'use strict'

const reduct = require('reduct')
const Prometheus = require('prom-client')
const Config = require('../../src/services/config').default
const RouteBuilder = require('../../src/services/route-builder').default
const RouteBroadcaster = require('../../src/services/route-broadcaster').default
const Accounts = require('../../src/services/accounts').default
const RateBackend = require('../../src/services/rate-backend').default
const RoutingTable = require('../../src/services/routing-table').default
const MiddlewareManager = require('../../src/services/middleware-manager').default
const AdminApi = require('../../src/services/admin-api').default
const CcpController = require('../../src/controllers/ccp').default
const Store = require('../../src/services/store').default
const ratesResponse = require('../data/fxRates.json')

const createApp = require('../../src').createApp

exports.create = function (context, opts) {
  process.env.CONNECTOR_STORE = 'memdown'
  process.env.CONNECTOR_ILP_ADDRESS = 'test.connie'

  // Set up test environment
  if (!process.env.CONNECTOR_ACCOUNTS) {
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify(require('../data/accountCredentials.json'))
  }

  if (!process.env.CONNECTOR_BACKEND) {
    process.env.CONNECTOR_BACKEND = 'ecb'
  }

  if (!process.env.CONNECTOR_BACKEND_CONFIG) {
    process.env.CONNECTOR_BACKEND_CONFIG = JSON.stringify({
      mockData: ratesResponse
    })
  }

  Prometheus.register.clear() // Clear metrics

  const deps = reduct()
  const app = createApp(opts || null, deps)

  context.app = app
  context.backend = deps(RateBackend)
  context.routingTable = deps(RoutingTable)
  context.routeBroadcaster = deps(RouteBroadcaster)
  context.routeBuilder = deps(RouteBuilder)
  context.accounts = deps(Accounts)
  context.config = deps(Config)
  context.middlewareManager = deps(MiddlewareManager)
  context.adminApi = deps(AdminApi)
  context.ccpController = deps(CcpController)
  context.store = deps(Store)
}
