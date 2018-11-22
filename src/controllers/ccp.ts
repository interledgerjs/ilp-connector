import { create as createLogger } from '../common/log'
const log = createLogger('ccp')
import RouteBroadcaster from '../services/route-broadcaster'
import reduct = require('reduct')
import { IlpPrepare, serializeIlpPrepare, IlpReply, deserializeIlpReply } from 'ilp-packet'
import {
  CCP_CONTROL_DESTINATION,
  CCP_UPDATE_DESTINATION,
  deserializeCcpRouteUpdateRequest,
  deserializeCcpRouteControlRequest,
  serializeCcpResponse
} from 'ilp-protocol-ccp'

export default class CcpController {
  protected routeBroadcaster: RouteBroadcaster

  constructor (deps: reduct.Injector) {
    this.routeBroadcaster = deps(RouteBroadcaster)
  }

  async handle (
    packet: IlpPrepare,
    sourceAccount: string
  ): Promise<IlpReply> {
    switch (packet.destination) {
      case CCP_CONTROL_DESTINATION:
        return this.handleRouteControl(packet, sourceAccount)
      case CCP_UPDATE_DESTINATION:
        return this.handleRouteUpdate(packet, sourceAccount)
      default:
        throw new Error('unrecognized ccp message. destination=' + packet.destination)
    }
  }

  async handleRouteControl (packet: IlpPrepare, sourceAccount: string) {
    // TODO - Update CCP module to accept just data payload
    const routeControl = deserializeCcpRouteControlRequest(serializeIlpPrepare(packet))
    log.trace('received route control message. sender=%s, tableId=%s epoch=%s features=%s', sourceAccount, routeControl.lastKnownRoutingTableId, routeControl.lastKnownEpoch, routeControl.features.join(','))

    this.routeBroadcaster.handleRouteControl(sourceAccount, routeControl)

    return deserializeIlpReply(serializeCcpResponse())
  }

  async handleRouteUpdate (packet: IlpPrepare, sourceAccount: string) {
    // TODO - Update CCP module to accept just data payload
    const routeUpdate = deserializeCcpRouteUpdateRequest(serializeIlpPrepare(packet))
    log.trace('received routes. sender=%s speaker=%s currentEpoch=%s fromEpoch=%s toEpoch=%s newRoutes=%s withdrawnRoutes=%s', sourceAccount, routeUpdate.speaker, routeUpdate.currentEpochIndex, routeUpdate.fromEpochIndex, routeUpdate.toEpochIndex, routeUpdate.newRoutes.length, routeUpdate.withdrawnRoutes.length)

    this.routeBroadcaster.handleRouteUpdate(sourceAccount, routeUpdate)

    return deserializeIlpReply(serializeCcpResponse())
  }
}
