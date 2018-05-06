import { Route } from '../types/routing'
import ForwardingRoutingTable, { RouteUpdate } from '../services/forwarding-routing-table'
import PrefixMap from './prefix-map'
import { mapValues } from 'lodash'

export function formatRouteAsJson (route: Route) {
  return {
    ...route,
    auth: undefined,
    path: route.path.join(' ')
  }
}

export function formatRoutingTableAsJson (routingTable: PrefixMap<Route>) {
  return mapValues(routingTable.toJSON(), formatRouteAsJson)
}

export function formatForwardingRoutingTableAsJson (routingTable: ForwardingRoutingTable) {
  return mapValues(routingTable.toJSON(), (routeUpdate: RouteUpdate) => (
    routeUpdate.route
    ? formatRouteAsJson(routeUpdate.route)
    : null
  ))
}
