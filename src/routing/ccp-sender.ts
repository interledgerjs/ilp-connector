import Accounts from '../services/accounts'
import ForwardingRoutingTable, { RouteUpdate } from '../services/forwarding-routing-table'
import { BroadcastRoute } from '../types/routing'
import { create as createLogger, ConnectorLogger } from '../common/log'
import { Relation } from './relation'
import {
  CcpRouteControlRequest,
  CcpRouteUpdateRequest,
  Mode,
  ModeReverseMap,
  serializeCcpRouteUpdateRequest
} from 'ilp-protocol-ccp'
import { PluginInstance } from '../types/plugin'

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

export interface CcpSenderOpts {
  accountId: string
  plugin: PluginInstance
  forwardingRoutingTable: ForwardingRoutingTable
  getOwnAddress: () => string
  getAccountRelation: (accountId: string) => Relation
  routeExpiry: number
  routeBroadcastInterval: number
}

const MINIMUM_UPDATE_INTERVAL = 150

const MAX_EPOCHS_PER_UPDATE = 50

export default class CcpSender {
  private plugin: PluginInstance
  private forwardingRoutingTable: ForwardingRoutingTable
  private log: ConnectorLogger
  private accountId: string
  private mode: Mode = Mode.MODE_IDLE
  private getOwnAddress: () => string
  private getAccountRelation: (accountId: string) => Relation
  private routeExpiry: number
  private routeBroadcastInterval: number

  /**
   * Next epoch that the peer requested from us.
   */
  private lastKnownEpoch: number = 0

  private lastUpdate: number = 0
  private sendRouteUpdateTimer?: NodeJS.Timer

  constructor ({
    accountId,
    plugin,
    forwardingRoutingTable,
    getOwnAddress,
    getAccountRelation,
    routeExpiry,
    routeBroadcastInterval
  }: CcpSenderOpts) {
    this.plugin = plugin
    this.forwardingRoutingTable = forwardingRoutingTable
    this.log = createLogger(`ccp-sender[${accountId}]`)
    this.accountId = accountId
    this.getOwnAddress = getOwnAddress
    this.getAccountRelation = getAccountRelation
    this.routeExpiry = routeExpiry
    this.routeBroadcastInterval = routeBroadcastInterval
  }

  stop () {
    if (this.sendRouteUpdateTimer) {
      clearTimeout(this.sendRouteUpdateTimer)
    }
  }

  getAccountId () {
    return this.accountId
  }

  getLastUpdate () {
    return this.lastUpdate
  }

  getLastKnownEpoch () {
    return this.lastKnownEpoch
  }

  getMode () {
    return this.mode
  }

  getStatus () {
    return {
      epoch: this.lastKnownEpoch,
      mode: ModeReverseMap[this.mode]
    }
  }

  handleRouteControl ({
    mode,
    lastKnownRoutingTableId,
    lastKnownEpoch,
    features
  }: CcpRouteControlRequest) {
    if (this.mode !== mode) {
      this.log.trace('peer requested changing routing mode. oldMode=%s newMode=%s', ModeReverseMap[this.mode], ModeReverseMap[mode])
    }
    this.mode = mode

    if (lastKnownRoutingTableId !== this.forwardingRoutingTable.routingTableId) {
      this.log.trace('peer has old routing table id, resetting lastKnownEpoch to zero. theirTableId=%s correctTableId=%s', lastKnownRoutingTableId, this.forwardingRoutingTable.routingTableId)
      this.lastKnownEpoch = 0
    } else {
      this.log.trace('peer epoch set. epoch=%s currentEpoch=%s', this.accountId, lastKnownEpoch, this.forwardingRoutingTable.currentEpoch)
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
      delay = this.routeBroadcastInterval - (Date.now() - lastUpdate)
    }

    delay = Math.max(MINIMUM_UPDATE_INTERVAL, delay)

    this.log.trace('scheduling next route update. accountId=%s delay=%s currentEpoch=%s peerHasEpoch=%s', this.accountId, delay, this.forwardingRoutingTable.currentEpoch, this.lastKnownEpoch)
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
    this.lastUpdate = Date.now()

    if (!this.plugin.isConnected()) {
      this.log.debug('cannot send routes, plugin not connected (yet).')
      return
    }

    const nextRequestedEpoch = this.lastKnownEpoch
    const allUpdates = this.forwardingRoutingTable.log
      .slice(nextRequestedEpoch, nextRequestedEpoch + MAX_EPOCHS_PER_UPDATE)

    const toEpoch = nextRequestedEpoch + allUpdates.length

    const relation = this.getAccountRelation(this.accountId)
    function isRouteUpdate (update: RouteUpdate | null): update is RouteUpdate {
      return !!update
    }

    const updates = allUpdates
      .filter(isRouteUpdate)
      .map((update: RouteUpdate) => {
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

    this.log.trace('broadcasting routes to peer. speaker=%s peer=%s fromEpoch=%s toEpoch=%s routeCount=%s unreachableCount=%s', this.getOwnAddress(), this.accountId, this.lastKnownEpoch, toEpoch, newRoutes.length, withdrawnRoutes.length)

    const routeUpdate: CcpRouteUpdateRequest = {
      speaker: this.getOwnAddress(),
      routingTableId: this.forwardingRoutingTable.routingTableId,
      holdDownTime: this.routeExpiry,
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

    const timeout = this.routeBroadcastInterval

    const timerPromise: Promise<Buffer> = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('route update timed out.')), timeout)
      // Don't let this timer keep Node running
      timer.unref()
    })

    try {
      await Promise.race([
        this.plugin.sendData(serializeCcpRouteUpdateRequest(routeUpdate)),
        timerPromise
      ])
    } catch (err) {
      this.lastKnownEpoch = previousNextRequestedEpoch
      throw err
    }
  }
}
