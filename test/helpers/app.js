'use strict'

const _ = require('lodash')
const http = require('http')
const superagent = require('co-supertest')
const log = require('../../src/common').log

const loadConfig = require('../../src/lib/config')
const InfoCache = require('../../src/lib/info-cache')
const RoutingTables = require('five-bells-routing').RoutingTables
const RouteBuilder = require('../../src/lib/route-builder')
const RouteBroadcaster = require('../../src/lib/route-broadcaster')
const makeCore = require('../../src/lib/core')
const BalanceCache = require('../../src/lib/balance-cache')

const createApp = require('five-bells-connector').createApp

exports.create = function (context) {
  const config = loadConfig()
  const Backend = require('../../src/backends/' + config.get('backend'))
  const backend = new Backend({
    currencyWithLedgerPairs: config.get('tradingPairs'),
    backendUri: config.get('backendUri'),
    spread: config.get('fxSpread')
  })
  const routingTables = new RoutingTables(config.server.base_uri, [], config.routeExpiry)
  const core = makeCore({config, log, routingTables})
  const infoCache = new InfoCache(core)
  const routeBuilder = new RouteBuilder(
    routingTables,
    infoCache,
    core,
    {
      minMessageWindow: config.expiry.minMessageWindow,
      slippage: config.slippage
    }
  )
  const routeBroadcaster = new RouteBroadcaster(routingTables, backend, core, infoCache, {
    tradingPairs: config.tradingPairs,
    minMessageWindow: config.expiry.minMessageWindow,
    routeCleanupInterval: config.routeCleanupInterval,
    routeBroadcastInterval: config.routeBroadcastInterval,
    routeShift: config.routeShift
  })
  const balanceCache = new BalanceCache(core)
  const app = createApp(config, core, backend, routeBuilder, routeBroadcaster, routingTables, infoCache, balanceCache)
  context.app = app
  context.backend = backend
  context.routingTables = routingTables
  context.routeBroadcaster = routeBroadcaster
  context.routeBuilder = routeBuilder
  context.core = core
  context.config = config
  context.infoCache = infoCache
  context.balanceCache = balanceCache

  context.server = http.createServer(app.callback()).listen()
  context.port = context.server.address().port
  context.request = function () {
    return superagent(context.server)
  }
  context.formatId = function (sourceObj, baseUri) {
    let obj = _.cloneDeep(sourceObj)
    obj.id = 'http://localhost' + baseUri + sourceObj.id
    return obj
  }
}
