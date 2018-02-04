import PrefixMap from '../routing/prefix-map'
import { Route } from '../types/routing'
import { uuid } from '../lib/utils'

export interface RouteUpdate {
  epoch: number,
  prefix: string
  route?: Route
}

export default class ForwardingRoutingTable extends PrefixMap<Route> {
  public routingTableId: string = uuid()
  public log: RouteUpdate[] = []
  public currentEpoch: number = 0
}
