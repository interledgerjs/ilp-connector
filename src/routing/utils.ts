import { Route } from '../types/routing'
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
