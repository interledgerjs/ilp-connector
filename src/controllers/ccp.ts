'use strict'

import { create as createLogger } from '../common/log'
const log = createLogger('ccp')
import { validate } from '../lib/validate'
import RouteBroadcaster from '../services/route-broadcaster'
import reduct = require('reduct')
import { RoutingUpdate } from '../schemas/RoutingUpdate'

import LiquidityCurve from '../routing/liquidity-curve'

export default class CcpController {
  protected routeBroadcaster: RouteBroadcaster

  constructor (deps: reduct.Injector) {
    this.routeBroadcaster = deps(RouteBroadcaster)
  }

  async handle (sourceAccount: string, payload: RoutingUpdate) {
    validate('RoutingUpdate', payload)
    log.debug('received routes. sender=%s', sourceAccount)

    const routeUpdate = {
      newRoutes: payload.new_routes.map(route => ({
        peer: sourceAccount,
        prefix: route.prefix,
        path: route.path,
        curve: typeof route.points === 'string' ? new LiquidityCurve(route.points) : undefined,
        minMessageWindow: (route.min_message_window || 1) * 1000
      })).filter(Boolean),
      unreachableThroughMe: payload.unreachable_through_me,
      holdDownTime: payload.hold_down_time,
      requestFullTable: payload.request_full_table || false
    }

    this.routeBroadcaster.handleRouteUpdate(sourceAccount, routeUpdate)

    return {}
  }
}
