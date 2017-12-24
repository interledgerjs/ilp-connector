'use strict'

const reduct = require('reduct')
const Config = require('../../src/services/config')
const RouteBuilder = require('../../src/services/route-builder')
const RouteBroadcaster = require('../../src/services/route-broadcaster')
const Accounts = require('../../src/services/accounts')
const Quoter = require('../../src/services/quoter')
const MessageRouter = require('../../src/services/message-router')
const RateBackend = require('../../src/services/rate-backend')
const RoutingTable = require('../../src/services/routing-table')

const createApp = require('../../src').createApp

exports.create = function (context, minBalance) {
  process.env.CONNECTOR_ILP_ADDRESS = 'test.connie'

  // Set up test environment
  if (!process.env.CONNECTOR_ACCOUNTS) {
    process.env.CONNECTOR_ACCOUNTS = JSON.stringify(require('../data/accountCredentials.json'))
  }
  process.env.CONNECTOR_DEBUG_REPLY_NOTIFICATIONS = 'true'

  process.env.CONNECTOR_SECRET = 'VafuntVJRw6YzDTs4IgIU1IPJACywtgUUQJHh1u018w='

  const deps = reduct()
  const app = createApp(deps)

  context.app = app
  context.backend = deps(RateBackend)
  context.quoter = deps(Quoter)
  context.routingTable = deps(RoutingTable)
  context.routeBroadcaster = deps(RouteBroadcaster)
  context.routeBuilder = deps(RouteBuilder)
  context.accounts = deps(Accounts)
  context.config = deps(Config)
  context.messageRouter = deps(MessageRouter)
}
