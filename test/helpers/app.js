'use strict'

const reduct = require('reduct')
const Config = require('../../src/services/config').default
const RouteBuilder = require('../../src/services/route-builder').default
const RouteBroadcaster = require('../../src/services/route-broadcaster').default
const Accounts = require('../../src/services/accounts').default
const Quoter = require('../../src/services/quoter').default
const RateBackend = require('../../src/services/rate-backend').default
const RoutingTable = require('../../src/services/routing-table').default
const MiddlewareManager = require('../../src/services/middleware-manager').default
const CcpController = require('../../src/controllers/ccp').default
const Store = require('../../src/services/store').default

const createApp = require('../../src').createApp

exports.create = function (context, opts) {
  opts = Object.assign({
    store: 'memdown',
    ilpAddress: 'test.connie',
    accounts: require('../data/accountCredentials.json'),
    routes: [
      {targetPrefix: 'cad-ledger', peerId: 'cad-ledger'},
      {targetPrefix: 'usd-ledger', peerId: 'usd-ledger'},
      {targetPrefix: 'eur-ledger', peerId: 'eur-ledger'},
      {targetPrefix: 'cny-ledger', peerId: 'cny-ledger'}
    ]
  }, opts)

  const deps = reduct()
  const app = createApp(opts, deps)

  context.app = app
  context.backend = deps(RateBackend)
  context.quoter = deps(Quoter)
  context.routingTable = deps(RoutingTable)
  context.routeBroadcaster = deps(RouteBroadcaster)
  context.routeBuilder = deps(RouteBuilder)
  context.accounts = deps(Accounts)
  context.config = deps(Config)
  context.middlewareManager = deps(MiddlewareManager)
  context.ccpController = deps(CcpController)
  context.store = deps(Store)
}
