import { Route } from '../types/routing'
import PrefixMap from './prefix-map'
import { mapValues } from 'lodash'

export function formatRoutingTableAsJson (routingTable: PrefixMap<Route>) {
  return mapValues(routingTable.toJSON(), r => ({ ...r, auth: undefined, path: r.path.join(' ') }))
}
