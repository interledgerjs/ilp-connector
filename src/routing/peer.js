'use strict'

const PrefixMap = require('./prefix-map')
const log = require('../common').log.create('routing-peer')

const PEER_PROTOCOL_PREFIX = 'peer'

class Peer {
  constructor ({ address }) {
    this.ilpAddress = address
    this.routes = new PrefixMap()
    this.epoch = -1
    this.expiry = 0
  }

  bump (holdDownTime) {
    this.expiry = Math.max(Date.now() + holdDownTime, this.expiry)
  }

  getAddress () {
    return this.ilpAddress
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
  }) {
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

    const changedPrefixes = []
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

  addRoute (route) {
    this.routes.insert(route.prefix, route)

    // TODO Check if actually changed
    return true
  }

  deleteRoute (prefix) {
    this.routes.delete(prefix)

    // TODO Check if actually changed
    return true
  }

  getPrefix (prefix) {
    return this.routes.get(prefix)
  }

  async broadcastRoutes ({ accounts, routes, broadcastCurves, holdDownTime, unreachableAccounts, requestFullTable = false, currentEpoch, timeout }) {
    const newRoutes = routes.filter(route => route.epoch > this.epoch && route.nextHop !== this.ilpAddress).map(route => ({
      prefix: route.prefix,
      path: route.path
    }))

    const unreachableThroughMe = unreachableAccounts.filter(route => route.epoch > this.epoch).map(route => route.prefix)

    log.debug('broadcasting routes to peer. peer=%s routeCount=%s unreachableCount=%s', this.ilpAddress, newRoutes.length, unreachableThroughMe.length)

    await accounts.getPlugin(this.ilpAddress).sendData(Buffer.from(JSON.stringify({
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

module.exports = Peer
