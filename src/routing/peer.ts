import PrefixMap from './prefix-map'
import Accounts from '../services/accounts'
import Config from '../services/config'
import ForwardingRoutingTable from '../services/forwarding-routing-table'
import { BroadcastRoute, IncomingRoute } from '../types/routing'
import { create as createLogger, ConnectorLogger } from '../common/log'
import reduct = require('reduct')
import { Relation } from './relation'
import {
  CcpRouteControlRequest,
  CcpRouteUpdateRequest,
  Mode,
  ModeReverseMap,
  serializeCcpRouteControlRequest,
  serializeCcpRouteUpdateRequest
} from 'ilp-protocol-ccp'

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
  private mode: Mode = Mode.MODE_IDLE

  /**
   * Next epoch that the peer requested from us.
   */
  private lastKnownEpoch: number = 0
  private lastKnownRoutingTableId: string = '00000000-0000-0000-0000-000000000000'
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
    return this.lastKnownEpoch
  }

  handleRouteControl ({
    mode,
    lastKnownRoutingTableId,
    lastKnownEpoch,
    features
  }: CcpRouteControlRequest) {
    if (this.mode !== mode) {
      this.log.debug('peer requested changing routing mode. oldMode=%s newMode=%s', ModeReverseMap[this.mode], ModeReverseMap[mode])
    }
    this.mode = mode

    if (this.lastKnownRoutingTableId !== this.forwardingRoutingTable.routingTableId) {
      this.log.debug('peer has old routing table id, resetting lastKnownEpoch to zero. theirTableId=%s correctTableId=%s', lastKnownRoutingTableId, this.forwardingRoutingTable.routingTableId)
      this.lastKnownEpoch = 0
    } else {
      this.log.debug('peer epoch set. epoch=%s currentEpoch=%s', this.accountId, lastKnownEpoch, this.forwardingRoutingTable.currentEpoch)
      this.lastKnownEpoch = lastKnownEpoch
    }

    // We don't support any optional features, so we ignore the `features`

    if (this.mode === Mode.MODE_SYNC) {
      // Start broadcasting routes to this peer
      this.scheduleRouteUpdate()
    } else {
      // Stop broadcasting routes to this peer
      if (this.sendRouteUpdateTimer) {
        clearTimeout(this.sendRouteUpdateTimer)
        this.sendRouteUpdateTimer = undefined
      }
    }
  }

  handleRouteUpdate ({
    speaker,
    routingTableId,
    fromEpochIndex,
    toEpochIndex,
    holdDownTime,
    newRoutes,
    withdrawnRoutes
  }: CcpRouteUpdateRequest): string[] {
    if (!this.receiveRoutes) {
      this.log.info('ignoring incoming route update from peer due to `receiveRoutes == false`. accountId=%s', this.accountId)
      // TODO: We should reject to let the peer know that we didn't process the update
      return []
    }

    this.bump(holdDownTime)

    if (this.lastKnownRoutingTableId !== routingTableId) {
      this.log.info('saw new routing table. oldId=%s newId=%s', this.lastKnownRoutingTableId, routingTableId)
      this.lastKnownRoutingTableId = routingTableId
      this.epoch = 0
    }

    if (fromEpochIndex > this.epoch) {
      // There is a gap, we need to go back to the last epoch we have
      this.log.debug('gap in routing updates. expectedEpoch=%s actualFromEpoch=%s', this.epoch, fromEpochIndex)
      return []
    }
    if (this.epoch > toEpochIndex) {
      // This routing update is older than what we already have
      this.log.debug('old routing update, ignoring. expectedEpoch=%s actualToEpoch=%s', this.epoch, toEpochIndex)
      return []
    }

    // just a heartbeat
    if (newRoutes.length === 0 && withdrawnRoutes.length === 0) {
      this.log.debug('pure heartbeat. fromEpoch=%s toEpoch=%s', fromEpochIndex, toEpochIndex)
      this.epoch = toEpochIndex
      return []
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
      if (this.addRoute({
        peer: this.accountId,
        prefix: route.prefix,
        path: route.path,
        auth: route.auth
      })) {
        changedPrefixes.push(route.prefix)
      }
    }

    this.epoch = toEpochIndex

    this.log.debug('applied route update. changedPrefixesCount=%s fromEpoch=%s toEpoch=%s', changedPrefixes.length, fromEpochIndex, toEpochIndex)

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

  sendRouteControl = () => {
    const plugin = this.accounts.getPlugin(this.accountId)

    if (!plugin || !plugin.isConnected()) {
      this.log.debug('cannot send route control message, plugin not connected (yet).')
      return
    }

    const routeControl: CcpRouteControlRequest = {
      mode: Mode.MODE_SYNC,
      lastKnownRoutingTableId: this.lastKnownRoutingTableId,
      lastKnownEpoch: this.epoch,
      features: []
    }

    plugin.sendData(serializeCcpRouteControlRequest(routeControl))
      .then(() => {
        this.log.debug('successfully sent route control message.')
      })
      .catch((err: any) => {
        const errInfo = (err instanceof Object && err.stack) ? err.stack : err
        this.log.debug('failed to broadcast route information to peer. error=%s', errInfo)
      })
  }

  scheduleRouteUpdate = () => {
    if (this.sendRouteUpdateTimer) {
      clearTimeout(this.sendRouteUpdateTimer)
      this.sendRouteUpdateTimer = undefined
    }

    if (this.mode !== Mode.MODE_SYNC) {
      return
    }

    const lastUpdate = this.lastUpdate
    const nextEpoch = this.lastKnownEpoch

    let delay: number
    if (nextEpoch < this.forwardingRoutingTable.currentEpoch) {
      delay = 0
    } else {
      delay = this.config.routeBroadcastInterval - (Date.now() - lastUpdate)
    }

    delay = Math.max(MINIMUM_UPDATE_INTERVAL, delay)

    this.log.debug('scheduling next route update. accountId=%s delay=%s currentEpoch=%s peerHasEpoch=%s', this.accountId, delay, this.forwardingRoutingTable.currentEpoch, this.lastKnownEpoch)
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
      this.log.debug('cannot send routes, plugin not connected (yet).')
      return
    }

    const nextRequestedEpoch = this.lastKnownEpoch
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

    this.log.debug('broadcasting routes to peer. peer=%s fromEpoch=%s toEpoch=%s routeCount=%s unreachableCount=%s', this.accountId, this.lastKnownEpoch, toEpoch, newRoutes.length, withdrawnRoutes.length)

    const routeUpdate: CcpRouteUpdateRequest = {
      speaker: this.accounts.getOwnAddress(),
      routingTableId: this.forwardingRoutingTable.routingTableId,
      holdDownTime: this.config.routeExpiry,
      currentEpochIndex: this.forwardingRoutingTable.currentEpoch,
      fromEpochIndex: this.lastKnownEpoch,
      toEpochIndex: toEpoch,
      newRoutes: newRoutes.map(r => ({
        ...r,
        nextHop: undefined,
        auth: r.auth,
        props: []
      })),
      withdrawnRoutes: withdrawnRoutes.map(r => r.prefix)
    }

    // We anticipate that they're going to be happy with our route update and
    // request the next one.
    const previousNextRequestedEpoch = this.lastKnownEpoch
    this.lastKnownEpoch = toEpoch

    const timeout = this.config.routeBroadcastInterval

    const timerPromise: Promise<Buffer> = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('route update timed out.')), timeout)
      // Don't let this timer keep Node running
      timer.unref()
    })

    try {
      await Promise.race([
        plugin.sendData(serializeCcpRouteUpdateRequest(routeUpdate)),
        timerPromise
      ])
    } catch (err) {
      this.lastKnownEpoch = previousNextRequestedEpoch
      throw err
    }
  }

  private getAccountRelation = (accountId: string): Relation => {
    return accountId ? this.accounts.getInfo(accountId).relation : 'local'
  }
}
