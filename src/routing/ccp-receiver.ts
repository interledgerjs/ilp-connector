import PrefixMap from './prefix-map'
import Accounts from '../services/accounts'
import { BroadcastRoute, IncomingRoute } from '../types/routing'
import { create as createLogger, ConnectorLogger } from '../common/log'
import { Type, deserializeIlpReject } from 'ilp-packet'
import {
  CcpRouteControlRequest,
  CcpRouteUpdateRequest,
  Mode,
  serializeCcpRouteControlRequest
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

export interface CcpReceiverOpts {
  plugin: PluginInstance
  accountId: string
}

const ROUTE_CONTROL_RETRY_INTERVAL = 30000

export default class CcpReceiver {
  private plugin: PluginInstance
  private log: ConnectorLogger
  private accountId: string
  private routes: PrefixMap<IncomingRoute>
  private expiry: number = 0

  /**
   * Current routing table id used by our peer.
   *
   * We'll reset our epoch if this changes.
   */
  private routingTableId: string = '00000000-0000-0000-0000-000000000000'
  /**
   * Epoch index up to which our peer has sent updates
   */
  private epoch: number = 0

  constructor ({ plugin, accountId }: CcpReceiverOpts) {
    this.plugin = plugin
    this.log = createLogger(`ccp-receiver[${accountId}]`)
    this.accountId = accountId
    this.routes = new PrefixMap()
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

  getRoutingTableId () {
    return this.routingTableId
  }

  getEpoch () {
    return this.epoch
  }

  getStatus () {
    return {
      routingTableId: this.routingTableId,
      epoch: this.epoch
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
    this.bump(holdDownTime)

    if (this.routingTableId !== routingTableId) {
      this.log.info('saw new routing table. oldId=%s newId=%s', this.routingTableId, routingTableId)
      this.routingTableId = routingTableId
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

  getPrefix (prefix: string) {
    return this.routes.get(prefix)
  }

  sendRouteControl = () => {
    if (!this.plugin.isConnected()) {
      this.log.debug('cannot send route control message, plugin not connected (yet).')
      return
    }

    const routeControl: CcpRouteControlRequest = {
      mode: Mode.MODE_SYNC,
      lastKnownRoutingTableId: this.routingTableId,
      lastKnownEpoch: this.epoch,
      features: []
    }

    this.plugin.sendData(serializeCcpRouteControlRequest(routeControl))
      .then(data => {
        if (data[0] === Type.TYPE_ILP_FULFILL) {
          this.log.debug('successfully sent route control message.')
        } else if (data[0] === Type.TYPE_ILP_REJECT) {
          this.log.debug('route control message was rejected. rejection=%j', deserializeIlpReject(data))
          throw new Error('route control message rejected.')
        } else {
          this.log.debug('unknown response packet type. type=' + data[0])
          throw new Error('route control message returned unknown response.')
        }
      })
      .catch((err: any) => {
        const errInfo = (err instanceof Object && err.stack) ? err.stack : err
        this.log.debug('failed to set route control information on peer. error=%s', errInfo)
        // TODO: Should have more elegant, thought-through retry logic here
        setTimeout(this.sendRouteControl, ROUTE_CONTROL_RETRY_INTERVAL)
      })
  }

  private addRoute (route: IncomingRoute) {
    this.routes.insert(route.prefix, route)

    // TODO Check if actually changed
    return true
  }

  private deleteRoute (prefix: string) {
    this.routes.delete(prefix)

    // TODO Check if actually changed
    return true
  }
}
