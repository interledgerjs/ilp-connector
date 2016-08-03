'use strict'
const routing = require('five-bells-routing')

/**
 * When routing payments across multiple ledgers, each hop will round the amounts
 * according to the precision of the ledger. These rounding errors can accumulate
 * to the point where a connector later in a path may receive an amount that is
 * less than the rate they are willing to accept.
 *
 * Connectors broadcast slightly pessimistic rate curves in order to compensate for
 * rounding errors across multi-hop routes. They shift the curve by the maximum
 * amount that could be lost due to rounding errors, so that even if the incoming
 * amount is rounded down by that amount the resulting value will still match the
 * connector's minimum rate.
 *
 * Connectors use unshifted rate curves locally to determine whether an incoming
 * payment request matches their minimum rate. When applying this rate, they round
 * in their favor to ensure that they never accept a payment that is lower than their rate.
 *
 * This class maintains two sets of routing.RoutingTables: the "local" tables are
 * the optimistic ones and the "public" tables are the pessimistic ones.
 *
 * The "local" tables consist of the raw local routes, joined to adjacent connector's
 * (public, shifted) routes. They are used for findBestHopFor*, the results of which
 * must be rounded in the connector's own favor to ensure that they don't lose money.
 *
 * The "public" tables consist of the local shifted routes, joined to the remote
 * (shifted) routes. Before joining, the local routes are shifted down by
 * 1/10^destination_ledger_scale to account for rounding errors. Their curves are
 * broadcast to adjacent connectors.
 */
class RoutingTables {
  constructor (baseURI, expiryDuration) {
    this.baseURI = baseURI
    this.localTables = new routing.RoutingTables(baseURI, [], expiryDuration)
    this.publicTables = new routing.RoutingTables(baseURI, [], expiryDuration)
  }

  * addLocalRoutes (infoCache, _localRoutes) {
    const localRoutes = _localRoutes.map(routing.Route.fromData)
    this.localTables.addLocalRoutes(localRoutes)

    // Shift the graph down by a small amount so that precision rounding doesn't
    // cause UnacceptableRateErrors.
    for (const localRoute of localRoutes) {
      const destinationAdjustment =
        yield this._getScaleAdjustment(infoCache, localRoute.destinationLedger)
      this.publicTables.addLocalRoutes([
        localRoute.shiftY(-destinationAdjustment)
      ])
    }
  }

  addRoute (route) {
    this.localTables.addRoute(route)
    return this.publicTables.addRoute(route)
  }

  findBestHopForSourceAmount (sourceLedger, destinationLedger, sourceAmount) {
    return this.localTables.findBestHopForSourceAmount(
      sourceLedger, destinationLedger, sourceAmount)
  }

  findBestHopForDestinationAmount (sourceLedger, destinationLedger, destinationAmount) {
    return this.localTables.findBestHopForDestinationAmount(
      sourceLedger, destinationLedger, destinationAmount)
  }

  toJSON (maxPoints) {
    return this.publicTables.toJSON(maxPoints)
  }

  removeExpiredRoutes () {
    this.localTables.removeExpiredRoutes()
    this.publicTables.removeExpiredRoutes()
  }

  * _getScaleAdjustment (infoCache, ledger) {
    const scale = (yield infoCache.get(ledger)).scale
    return scale ? Math.pow(10, -scale) : 0
  }
}

module.exports = RoutingTables
