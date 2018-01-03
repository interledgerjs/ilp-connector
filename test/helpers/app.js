'use strict'

const reduct = require('reduct')
const Config = require('../../src/services/config').default
const RouteBuilder = require('../../src/services/route-builder').default
const RouteBroadcaster = require('../../src/services/route-broadcaster').default
const Accounts = require('../../src/services/accounts').default
const Balances = require('../../src/services/balances').default
const Quoter = require('../../src/services/quoter').default
const MessageRouter = require('../../src/services/message-router').default
const RateBackend = require('../../src/services/rate-backend').default
const RoutingTable = require('../../src/services/routing-table').default
const CcpController = require('../../src/controllers/ccp').default
const Store = require('../../src/services/store').default

const createApp = require('../../src').createApp

exports.create = function (context, minBalance) {
  process.env.CONNECTOR_STORE = 'memdown'
  process.env.CONNECTOR_ILP_ADDRESS = 'test.connie'

  // Set up test environment
  if (!process.env.CONNECTOR_ACCOUNTS) {
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify(require('../data/accountCredentials.json'))
  }

  const deps = reduct()
  const app = createApp(null, deps)

  context.app = app
  context.backend = deps(RateBackend)
  context.quoter = deps(Quoter)
  context.routingTable = deps(RoutingTable)
  context.routeBroadcaster = deps(RouteBroadcaster)
  context.routeBuilder = deps(RouteBuilder)
  context.accounts = deps(Accounts)
  context.balances = deps(Balances)
  context.config = deps(Config)
  context.messageRouter = deps(MessageRouter)
  context.ccpController = deps(CcpController)
  context.store = deps(Store)
}
