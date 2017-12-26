'use strict'

const log = require('../common/log').create('ccp')
const validate = require('../lib/validate').validate
const RouteBroadcaster = require('../services/route-broadcaster')

const LiquidityCurve = require('../routing/liquidity-curve')

class CcpController {
  constructor (deps) {
    this.routeBroadcaster = deps(RouteBroadcaster)
  }

  async handle (sourceAccount, payload) {
    validate('RoutingUpdate', payload)
    log.debug('received routes. sender=%s', sourceAccount)

    const routeUpdate = {
      newRoutes: payload.new_routes.map(route => (
        route.source_ledger !== route.source_account
        ? null
        : {
          peer: sourceAccount,
          prefix: route.target_prefix || route.destination_ledger,
          distance: Math.max(route.paths && route.paths[0] && route.paths[0].length || 1, 1),
          curve: route.points && new LiquidityCurve(route.points),
          minMessageWindow: route.min_message_window * 1000
        }
      )).filter(Boolean),
      unreachableThroughMe: payload.unreachable_through_me,
      holdDownTime: payload.hold_down_time,
      requestFullTable: payload.request_full_table
    }

    this.routeBroadcaster.handleRouteUpdate(sourceAccount, routeUpdate)
  }
}

module.exports = CcpController
