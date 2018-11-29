'use strict'

const reduct = require('reduct')
const Prometheus = require('prom-client')
const Config = require('../../build/services/config').default
const RouteBuilder = require('../../build/services/route-builder').default
const RouteBroadcaster = require('../../build/services/route-broadcaster').default
const Accounts = require('../../build/services/accounts').default
const RateBackend = require('../../build/services/rate-backend').default
const RoutingTable = require('../../build/services/routing-table').default
const AdminApi = require('../../build/services/admin-api').default
const CcpController = require('../../build/controllers/ccp').default
const Store = require('../../build/services/store').default
const ratesResponse = require('../data/fxRates.json')

const createApp = require('../../build').createApp

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
  context.adminApi = deps(AdminApi)
  context.ccpController = deps(CcpController)
  context.store = deps(Store)
}
