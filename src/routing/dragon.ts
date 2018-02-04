import { Route } from '../types/routing'
import PrefixMap from './prefix-map'
import { create as createLogger } from '../common/log'
const log = createLogger('dragon')
import { Relation, getRelationPriority } from './relation'

/**
 * Check whether a route can be filtered out based on DRAGON rules.
 *
 * See http://route-aggregation.net/.
 *
 * The basic idea is that if we have a more general route that is as good as a
 * more specific route, we don't need to advertise the more specific route.
 *
 * This removes a lot of routing update across a large network and has basically
 * no downside.
 *
 * Note that we use DRAGON filtering, but *not* DRAGON aggregation. There are
 * several reasons for this:
 *
 *  * ILP address space is a lot less dense than IPv4 address space, so
 *    DRAGON aggregation would not be a significant optimization.
 *
 *  * We may want to secure our routing protocol using a mechanism similar to
 *    BGPsec, which precludes aggregation.
 *
 *  * We will recommend that owners of tier-1 ILP address space are also real
 *    connectors which participate in the routing protocol and originate a route
 *    advertisement for their tier-1 prefix. This will enable DRAGON filtering
 *    to apply to a lot more situations where otherwise only DRAGON aggregation
 *    would be applicable.
 */
export function canDragonFilter (
  routingTable: PrefixMap<Route>,
  getRelation: (prefix: string) => Relation,
  prefix: string,
  route: Route
): boolean {
  // Find any less specific route
  const parentPrefix = routingTable.resolvePrefix(prefix.slice(0, prefix.length - 1))

  if (!parentPrefix) {
    // No less specific route, cannot DRAGON filter
    return false
  }

  const parentRoute = routingTable.get(parentPrefix)

  if (!parentRoute) {
    log.warn('found a parent prefix, but no parent route; this should never happen. prefix=%s parentPrefix=%s', prefix, parentPrefix)
    return false
  }

  if (parentRoute.nextHop === '') {
    // We are the origin of the parent route, cannot DRAGON filter
    return false
  }

  const parentRelation = getRelation(parentRoute.nextHop)
  const childRelation = getRelation(route.nextHop)
  if (getRelationPriority(parentRelation) < getRelationPriority(childRelation)) {
    // The more specific route is better for us, so we keep it
    return false
  }

  log.debug('applied DRAGON route filter. prefix=%s parentPrefix=%s', prefix, parentPrefix)
  return true
}
