import PrefixMap from './prefix-map'
import Accounts from '../services/accounts'
import { BroadcastRoute, RouteUpdateParams, IncomingRoute } from '../types/routing'
import { RoutingUpdate } from '../schemas/RoutingUpdate'
import { RoutingUpdateResponse } from '../schemas/RoutingUpdateResponse'
import { create as createLogger } from '../common/log'
const log = createLogger('routing-peer')

export interface BroadcastRoutesParams {
  accounts: Accounts,
  newRoutes: BroadcastRoute[],
  routingTableId: string,
  holdDownTime: number,
  withdrawnRoutes: { prefix: string, epoch: number }[],
  fromEpoch: number,
  toEpoch: number,
  timeout: number
}

export interface PeerOpts {
  accountId: string,
  sendRoutes: boolean,
  receiveRoutes: boolean
}

export default class Peer {
  private accountId: string
  private sendRoutes: boolean
  private receiveRoutes: boolean
  private routes: PrefixMap<IncomingRoute>
  private expiry: number
  private nextRequestedEpoch: number
  private routingTableId: string

  constructor ({ accountId, sendRoutes, receiveRoutes }: PeerOpts) {
    this.accountId = accountId
    this.sendRoutes = sendRoutes
    this.receiveRoutes = receiveRoutes
    this.routes = new PrefixMap()
    this.nextRequestedEpoch = 0
    this.expiry = 0
    this.routingTableId = ''
  }

  bump (holdDownTime: number) {
    this.expiry = Math.max(Date.now() + holdDownTime, this.expiry)
  }

  getAccountId () {
    return this.accountId
  }

  getExpiry () {
    return this.expiry
  }

  getPrefixes () {
    return this.routes.keys()
  }

  applyRouteUpdate ({
    routingTableId,
    fromEpoch,
    toEpoch,
    newRoutes,
    withdrawnRoutes,
    holdDownTime
  }: RouteUpdateParams) {
    if (!this.receiveRoutes) {
      log.info('ignoring incoming route update from peer due to `receiveRoutes == false`. accountId=%s', this.accountId)
      return {
        changedPrefixes: [],
        nextRequestedEpoch: toEpoch
      }
    }

    this.bump(holdDownTime)

    if (this.routingTableId !== routingTableId) {
      log.info('saw new routing table. oldId=%s newId=%s', this.routingTableId, routingTableId)
      this.routingTableId = routingTableId
      this.nextRequestedEpoch = 0
    }
    if (fromEpoch > this.nextRequestedEpoch) {
      // There is a gap, we need to go back to the last epoch we have
      return {
        changedPrefixes: [],
        nextRequestedEpoch: this.nextRequestedEpoch
      }
    }
    if (this.nextRequestedEpoch >= toEpoch) {
      // This routing update is older than what we already have
      return {
        changedPrefixes: [],
        nextRequestedEpoch: this.nextRequestedEpoch
      }
    }

    // just a heartbeat
    if (newRoutes.length === 0 && withdrawnRoutes.length === 0) {
      log.debug('pure heartbeat.')
      return {
        changedPrefixes: [],
        nextRequestedEpoch: toEpoch
      }
    }

    const changedPrefixes: string[] = []
    if (withdrawnRoutes.length > 0) {
      log.info('informed of no longer reachable routes. count=%s routes=%s', withdrawnRoutes.length, withdrawnRoutes)
      for (const prefix of withdrawnRoutes) {
        if (this.deleteRoute(prefix)) {
          changedPrefixes.push(prefix)
        }
      }
    }

    for (const route of newRoutes) {
      if (this.addRoute(route)) {
        changedPrefixes.push(route.prefix)
      }
    }

    log.debug('applied route update. changedPrefixesCount=%s', changedPrefixes.length)

    return {
      changedPrefixes,
      nextRequestedEpoch: toEpoch
    }
  }

  addRoute (route: IncomingRoute) {
    this.routes.insert(route.prefix, route)

    // TODO Check if actually changed
    return true
  }

  deleteRoute (prefix: string) {
    this.routes.delete(prefix)

    // TODO Check if actually changed
    return true
  }

  getPrefix (prefix: string) {
    return this.routes.get(prefix)
  }

  async sendRouteUpdate ({
    accounts,
    routingTableId,
    holdDownTime,
    fromEpoch,
    toEpoch,
    newRoutes,
    withdrawnRoutes,
    timeout
  }: BroadcastRoutesParams) {
    if (!this.sendRoutes) {
      return
    }

    log.debug('broadcasting routes to peer. peer=%s routeCount=%s unreachableCount=%s', this.accountId, newRoutes.length, withdrawnRoutes.length)

    const routeUpdate: RoutingUpdate = {
      speaker: accounts.getOwnAddress(),
      routing_table_id: routingTableId,
      hold_down_time: holdDownTime,
      from_epoch: fromEpoch,
      to_epoch: toEpoch,
      new_routes: newRoutes,
      withdrawn_routes: withdrawnRoutes.map(r => r.prefix)
    }

    const result = await accounts.getPlugin(this.accountId).sendData(Buffer.from(JSON.stringify({
      method: 'broadcast_routes',
      data: routeUpdate
    }), 'utf8'))

    const response: RoutingUpdateResponse = JSON.parse(result.toString('utf8'))

    this.nextRequestedEpoch = response.next_requested_epoch
  }

  getRequestedRouteUpdate () {
    return {
      nextRequestedEpoch: this.nextRequestedEpoch
    }
  }
}
