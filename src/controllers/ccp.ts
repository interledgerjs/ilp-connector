import { create as createLogger } from '../common/log'
const log = createLogger('ccp')
import RouteBroadcaster from '../services/route-broadcaster'
import reduct = require('reduct')
import { IlpPrepare } from 'ilp-packet'
import {
  deserializeCcpRouteUpdateRequest,
  deserializeCcpRouteControlRequest,
  serializeCcpResponse
} from 'ilp-protocol-ccp'

const CCP_CONTROL_DESTINATION = 'peer.route.control'
const CCP_UPDATE_DESTINATION = 'peer.route.update'

export default class CcpController {
  protected routeBroadcaster: RouteBroadcaster

  constructor (deps: reduct.Injector) {
    this.routeBroadcaster = deps(RouteBroadcaster)
  }

  async handle (
    data: Buffer,
    sourceAccount: string,
    { parsedPacket }: { parsedPacket: IlpPrepare }
  ) {
    switch (parsedPacket.destination) {
      case CCP_CONTROL_DESTINATION:
        return this.handleRouteControl(data, sourceAccount)
      case CCP_UPDATE_DESTINATION:
        return this.handleRouteUpdate(data, sourceAccount)
      default:
        throw new Error('unrecognized ccp message. destination=' + parsedPacket.destination)
    }
  }

  async handleRouteControl (data: Buffer, sourceAccount: string) {
    const routeControl = deserializeCcpRouteControlRequest(data)
    log.debug('received route control message. sender=%s, tableId=%s epoch=%s features=%s', sourceAccount, routeControl.lastKnownRoutingTableId, routeControl.lastKnownEpoch, routeControl.features.join(','))

    this.routeBroadcaster.handleRouteControl(sourceAccount, routeControl)

    return serializeCcpResponse()
  }

  async handleRouteUpdate (data: Buffer, sourceAccount: string) {
    const routeUpdate = deserializeCcpRouteUpdateRequest(data)
    log.debug('received routes. sender=%s speaker=%s currentEpoch=%s fromEpoch=%s toEpoch=%s newRoutes=%s withdrawnRoutes=%s', sourceAccount, routeUpdate.speaker, routeUpdate.currentEpochIndex, routeUpdate.fromEpochIndex, routeUpdate.toEpochIndex, routeUpdate.newRoutes.length, routeUpdate.withdrawnRoutes.length)

    this.routeBroadcaster.handleRouteUpdate(sourceAccount, routeUpdate)

    return serializeCcpResponse()
  }
}
