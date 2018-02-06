import PrefixMap from './prefix-map'
import Accounts from '../services/accounts'
import Config from '../services/config'
import ForwardingRoutingTable from '../services/forwarding-routing-table'
import { BroadcastRoute, RouteUpdateParams, IncomingRoute } from '../types/routing'
import { RoutingUpdate } from '../schemas/RoutingUpdate'
import { RoutingUpdateResponse } from '../schemas/RoutingUpdateResponse'
import { create as createLogger, ConnectorLogger } from '../common/log'
import reduct = require('reduct')
import { Relation } from './relation'

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
  deps: reduct.Injector,
  accountId: string,
  sendRoutes: boolean,
  receiveRoutes: boolean
}

const MINIMUM_UPDATE_INTERVAL = 150

export default class Peer {
  private config: Config
  private accounts: Accounts
  private forwardingRoutingTable: ForwardingRoutingTable
  private log: ConnectorLogger
  private accountId: string
  private sendRoutes: boolean
  private receiveRoutes: boolean
  private routes: PrefixMap<IncomingRoute>
  private expiry: number = 0
  /**
   * Next epoch that the peer requested from us.
   */
  private nextRequestedEpoch: number = 0
  private peerRoutingTableId: string = ''
  /**
   * Epoch index up to which our peer has sent updates
   */
  private epoch: number = 0

  private lastUpdate: number = 0
  private sendRouteUpdateTimer?: NodeJS.Timer

  constructor ({ deps, accountId, sendRoutes, receiveRoutes }: PeerOpts) {
    this.config = deps(Config)
    this.accounts = deps(Accounts)
    this.forwardingRoutingTable = deps(ForwardingRoutingTable)
    this.log = createLogger(`routing-peer[${accountId}]`)
    this.accountId = accountId
    this.sendRoutes = sendRoutes
    this.receiveRoutes = receiveRoutes
    this.routes = new PrefixMap()
  }

  stop () {
    if (this.sendRouteUpdateTimer) {
      clearTimeout(this.sendRouteUpdateTimer)
    }
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

  getLastUpdate () {
    return this.lastUpdate
  }

  getNextRequestedEpoch () {
    return this.nextRequestedEpoch
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
      this.log.info('ignoring incoming route update from peer due to `receiveRoutes == false`. accountId=%s', this.accountId)
      // TODO: We should reject to let the peer know that we didn't process the update
      return {
        changedPrefixes: [],
        nextRequestedEpoch: toEpoch
      }
    }

    this.bump(holdDownTime)

    if (this.peerRoutingTableId !== routingTableId) {
      this.log.info('saw new routing table. oldId=%s newId=%s', this.peerRoutingTableId, routingTableId)
      this.peerRoutingTableId = routingTableId
      this.epoch = 0
    }

    if (fromEpoch > this.epoch) {
      // There is a gap, we need to go back to the last epoch we have
      this.log.debug('gap in routing updates. expectedEpoch=%s actualFromEpoch=%s', this.epoch, fromEpoch)
      return {
        changedPrefixes: [],
        nextRequestedEpoch: this.epoch
      }
    }
    if (this.epoch > toEpoch) {
      // This routing update is older than what we already have
      this.log.debug('old routing update, ignoring. expectedEpoch=%s actualToEpoch=%s', this.epoch, toEpoch)
      return {
        changedPrefixes: [],
        nextRequestedEpoch: this.epoch
      }
    }

    // just a heartbeat
    if (newRoutes.length === 0 && withdrawnRoutes.length === 0) {
      this.log.debug('pure heartbeat. fromEpoch=%s toEpoch=%s', fromEpoch, toEpoch)
      this.epoch = toEpoch
      return {
        changedPrefixes: [],
        nextRequestedEpoch: toEpoch
      }
    }

    const changedPrefixes: string[] = []
    if (withdrawnRoutes.length > 0) {
      this.log.info('informed of no longer reachable routes. count=%s routes=%s', withdrawnRoutes.length, withdrawnRoutes)
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

    this.epoch = toEpoch

    this.log.debug('applied route update. changedPrefixesCount=%s fromEpoch=%s toEpoch=%s', changedPrefixes.length, fromEpoch, toEpoch)

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

  scheduleRouteUpdate = () => {
    if (this.sendRouteUpdateTimer) {
      clearTimeout(this.sendRouteUpdateTimer)
      this.sendRouteUpdateTimer = undefined
    }

    const lastUpdate = this.lastUpdate
    const nextEpoch = this.nextRequestedEpoch

    let delay: number
    if (nextEpoch < this.forwardingRoutingTable.currentEpoch) {
      delay = 0
    } else {
      delay = this.config.routeBroadcastInterval - (Date.now() - lastUpdate)
    }

    delay = Math.max(MINIMUM_UPDATE_INTERVAL, delay)

    // Log statement intentionally commented out -- too verbose
    this.log.debug('scheduling next route update. accountId=%s delay=%s currentEpoch=%s peerHasEpoch=%s', this.accountId, delay, this.forwardingRoutingTable.currentEpoch, this.nextRequestedEpoch)
    this.sendRouteUpdateTimer = setTimeout(() => {
      this.sendSingleRouteUpdate()
        .then(() => this.scheduleRouteUpdate())
        .catch((err: any) => {
          const errInfo = (err instanceof Object && err.stack) ? err.stack : err
          this.log.debug('failed to broadcast route information to peer. peer=%s error=%s', this.accountId, errInfo)
        })
    }, delay)
    this.sendRouteUpdateTimer.unref()
  }

  private async sendSingleRouteUpdate () {
    if (!this.sendRoutes) {
      return
    }

    this.lastUpdate = Date.now()

    const plugin = this.accounts.getPlugin(this.accountId)

    if (!plugin || !plugin.isConnected()) {
      // Log statement intentionally commented out -- too verbose
      this.log.debug('cannot send routes, plugin not connected (yet). accountId=%s', this.accountId)
      return
    }

    const nextRequestedEpoch = this.nextRequestedEpoch
    // TODO: Slicing copies that portion of the array. If we are sending a
    // large routing table in small chunks it would be much faster to loop
    // over the log and write the
    const allUpdates = this.forwardingRoutingTable.log.slice(nextRequestedEpoch)
    const highestEpochUpdate = allUpdates.slice(allUpdates.length - 1)[0]

    const toEpoch = highestEpochUpdate
      ? highestEpochUpdate.epoch + 1
      : nextRequestedEpoch

    const relation = this.getAccountRelation(this.accountId)
    const updates = allUpdates
      .map(update => {
        if (!update.route) return update

        if (
          // Don't send peer their own routes
          update.route.nextHop === this.accountId ||

          // Don't advertise peer and provider routes to providers
          (
            relation === 'parent' &&
            ['peer', 'parent'].indexOf(this.getAccountRelation(update.route.nextHop)) !== -1
          )
        ) {
          return {
            ...update,
            route: undefined
          }
        } else {
          return update
        }
      })

    const newRoutes: BroadcastRoute[] = []
    const withdrawnRoutes: { prefix: string, epoch: number }[] = []

    for (const update of updates) {
      if (update.route) {
        newRoutes.push({
          prefix: update.prefix,
          nextHop: update.route.nextHop,
          path: update.route.path,
          auth: update.route.auth
        })
      } else {
        withdrawnRoutes.push({
          prefix: update.prefix,
          epoch: update.epoch
        })
      }
    }

    this.log.debug('broadcasting routes to peer. peer=%s fromEpoch=%s toEpoch=%s routeCount=%s unreachableCount=%s', this.accountId, this.nextRequestedEpoch, toEpoch, newRoutes.length, withdrawnRoutes.length)

    const routeUpdate: RoutingUpdate = {
      speaker: this.accounts.getOwnAddress(),
      routing_table_id: this.forwardingRoutingTable.routingTableId,
      hold_down_time: this.config.routeExpiry,
      from_epoch: this.nextRequestedEpoch,
      to_epoch: toEpoch,
      new_routes: newRoutes.map(r => ({
        ...r,
        nextHop: undefined,
        auth: r.auth.toString('base64')
      })),
      withdrawn_routes: withdrawnRoutes.map(r => r.prefix)
    }

    // We anticipate that they're going to be happy with our route update and
    // request the next one.
    const previousNextRequestedEpoch = this.nextRequestedEpoch
    this.nextRequestedEpoch = toEpoch

    const timeout = this.config.routeBroadcastInterval

    const timerPromise: Promise<Buffer> = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('route update timed out.')), timeout)
      // Don't let this timer keep Node running
      timer.unref()
    })

    try {
      const result = await Promise.race([
        plugin.sendData(Buffer.from(JSON.stringify({
          method: 'broadcast_routes',
          data: routeUpdate
        }), 'utf8')),
        timerPromise
      ])

      const response: RoutingUpdateResponse = JSON.parse(result.toString('utf8'))

      // If the epoch they request isn't what we predicted, we need to adjust and
      // continue from there.
      if (response.next_requested_epoch !== toEpoch) {
        this.nextRequestedEpoch = response.next_requested_epoch
      }
    } catch (err) {
      this.nextRequestedEpoch = previousNextRequestedEpoch
      throw err
    }
  }

  private getAccountRelation = (accountId: string): Relation => {
    return accountId ? this.accounts.getInfo(accountId).relation : 'local'
  }
}
