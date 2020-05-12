'use strict'

const reduct = require('reduct')
const Prometheus = require('prom-client')
const Config = require('../../dist/services/config').default
const RouteBuilder = require('../../dist/services/route-builder').default
const RouteBroadcaster = require('../../dist/services/route-broadcaster').default
const Accounts = require('../../dist/services/accounts').default
const RateBackend = require('../../dist/services/rate-backend').default
const RoutingTable = require('../../dist/services/routing-table').default
const MiddlewareManager = require('../../dist/services/middleware-manager').default
const AdminApi = require('../../dist/services/admin-api').default
const CcpController = require('../../dist/controllers/ccp').default
const Store = require('../../dist/services/store').default
const ratesResponse = require('../data/fxRates.json')

const createApp = require('../../dist').createApp

exports.create = function (context, opts) {
  process.env.CONNECTOR_STORE = 'memory'
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
