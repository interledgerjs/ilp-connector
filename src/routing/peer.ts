'use strict'

import PrefixMap from './prefix-map'
import Accounts from '../services/accounts'
import { Route, BroadcastRoute, RouteUpdateParams, IncomingRoute } from '../types/routing'
import { create as createLogger } from '../common/log'
const log = createLogger('routing-peer')

const PEER_PROTOCOL_PREFIX = 'peer'

export interface BroadcastRoutesParams {
  accounts: Accounts,
  routes: BroadcastRoute[],
  broadcastCurves: boolean,
  holdDownTime: number,
  unreachableAccounts: { prefix: string, epoch: number }[],
  requestFullTable: boolean,
  currentEpoch: number,
  timeout: number
}

export default class Peer {
  protected accountId: string
  protected routes: PrefixMap<IncomingRoute>
  protected epoch: number
  protected expiry: number

  constructor ({ accountId }: { accountId: string }) {
    this.accountId = accountId
    this.routes = new PrefixMap()
    this.epoch = -1
    this.expiry = 0
  }

  bump (holdDownTime: number) {
    this.expiry = Math.max(Date.now() + holdDownTime, this.expiry)
  }

  getAddress () {
    return this.accountId
  }

  getExpiry () {
    return this.expiry
  }

  getPrefixes () {
    return this.routes.keys()
  }

  applyRouteUpdate ({
    newRoutes,
    unreachableThroughMe,
    requestFullTable,
    holdDownTime
  }: RouteUpdateParams) {
    this.bump(holdDownTime)

    if (requestFullTable) {
      log.info('peer requested full table.')
      this.epoch = -1
    }

    // just a heartbeat
    if (newRoutes.length === 0 && unreachableThroughMe.length === 0) {
      log.debug('pure heartbeat.')
      return []
    }

    const changedPrefixes: string[] = []
    if (unreachableThroughMe.length > 0) {
      log.info('informed of no longer reachable routes. count=%s routes=%s', unreachableThroughMe.length, unreachableThroughMe)
      for (const prefix of unreachableThroughMe) {
        if (this.deleteRoute(prefix)) {
          changedPrefixes.push(prefix)
        }
      }
    }

    for (const route of newRoutes) {
      // The destination_ledger can be any ledger except one that starts with `peer.`
      // TODO Route filters should be much more configurable
      if (route.prefix.startsWith(PEER_PROTOCOL_PREFIX)) {
        log.debug('ignoring route starting with "peer". prefix=%s', route.prefix)
        continue
      }

      if (this.addRoute(route)) {
        changedPrefixes.push(route.prefix)
      }
    }

    log.debug('applied route update. changedPrefixesCount=%s', changedPrefixes.length)

    return changedPrefixes
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

  async broadcastRoutes ({
    accounts,
    routes,
    broadcastCurves,
    holdDownTime,
    unreachableAccounts,
    requestFullTable = false,
    currentEpoch,
    timeout
  }: BroadcastRoutesParams) {
    const newRoutes = routes.filter(route => route.epoch > this.epoch && route.nextHop !== this.accountId).map(route => ({
      prefix: route.prefix,
      path: route.path
    }))

    const unreachableThroughMe = unreachableAccounts.filter(route => route.epoch > this.epoch).map(route => route.prefix)

    log.debug('broadcasting routes to peer. peer=%s routeCount=%s unreachableCount=%s', this.accountId, newRoutes.length, unreachableThroughMe.length)

    await accounts.getPlugin(this.accountId).sendData(Buffer.from(JSON.stringify({
      custom: {
        method: 'broadcast_routes',
        data: {
          new_routes: newRoutes,
          hold_down_time: holdDownTime,
          unreachable_through_me: unreachableThroughMe,
          request_full_table: requestFullTable
        }
      },
      // timeout the plugin.sendRequest Promise just so we don't have it hanging around forever
      timeout
    }), 'utf8'))

    this.epoch = currentEpoch
  }
}
