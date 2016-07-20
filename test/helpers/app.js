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
const Multiledger = require('../../src/lib/multiledger')
const BalanceCache = require('../../src/lib/balance-cache')

const createApp = require('five-bells-connector').createApp

exports.create = function (context) {
  const config = loadConfig()
  const ledgers = new Multiledger({
    config: config,
    log: log
  })
  const infoCache = new InfoCache(ledgers)
  const Backend = require('../../src/backends/' + config.get('backend'))
  const backend = new Backend({
    currencyWithLedgerPairs: config.get('tradingPairs'),
    backendUri: config.get('backendUri'),
    spread: config.get('fxSpread')
  })
  const routingTables = new RoutingTables(config.server.base_uri, [], config.routeExpiry)
  const routeBuilder = new RouteBuilder(
    routingTables,
    infoCache,
    ledgers,
    {
      minMessageWindow: config.expiry.minMessageWindow,
      slippage: config.slippage
    }
  )
  const routeBroadcaster = new RouteBroadcaster(routingTables, backend, ledgers, infoCache, {
    tradingPairs: config.tradingPairs,
    minMessageWindow: config.expiry.minMessageWindow,
    routeCleanupInterval: config.routeCleanupInterval,
    routeBroadcastInterval: config.routeBroadcastInterval,
    routeShift: config.routeShift
  })
  const balanceCache = new BalanceCache(ledgers)
  const app = createApp(config, ledgers, backend, routeBuilder, routeBroadcaster, routingTables, infoCache, balanceCache)
  context.app = app
  context.backend = backend
  context.routingTables = routingTables
  context.routeBroadcaster = routeBroadcaster
  context.routeBuilder = routeBuilder
  context.ledgers = ledgers
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
