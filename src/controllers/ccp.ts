import { create as createLogger } from '../common/log'
const log = createLogger('ccp')
import { validate } from '../lib/validate'
import RouteBroadcaster from '../services/route-broadcaster'
import reduct = require('reduct')
import { RoutingUpdate } from '../schemas/RoutingUpdate'
import { RoutingUpdateResponse } from '../schemas/RoutingUpdateResponse'

export default class CcpController {
  protected routeBroadcaster: RouteBroadcaster

  constructor (deps: reduct.Injector) {
    this.routeBroadcaster = deps(RouteBroadcaster)
  }

  async handle (payload: RoutingUpdate, sourceAccount: string) {
    validate('RoutingUpdate', payload)
    log.debug('received routes. sender=%s', sourceAccount)

    const routeUpdate = {
      speaker: payload.speaker,
      routingTableId: payload.routing_table_id,
      holdDownTime: payload.hold_down_time,
      fromEpoch: payload.from_epoch,
      toEpoch: payload.to_epoch,
      newRoutes: payload.new_routes.map(route => ({
        peer: sourceAccount,
        prefix: route.prefix,
        path: route.path
      })).filter(Boolean),
      withdrawnRoutes: payload.withdrawn_routes
    }

    const { nextRequestedEpoch } =
      this.routeBroadcaster.handleRouteUpdate(sourceAccount, routeUpdate)

    const response: RoutingUpdateResponse = {
      next_requested_epoch: nextRequestedEpoch
    }

    return response
  }
}
