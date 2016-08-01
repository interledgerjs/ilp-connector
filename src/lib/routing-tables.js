'use strict'
const routing = require('five-bells-routing')

/**
 * Maintain two sets of `routing.RoutingTables`.
 *
 * The "local" tables consist of the raw local routes, joined to the
 * remote (shifted) routes.
 *
 * The "public" tables consist of the local shifted routes, joined to the
 * remote (shifted) routes.
 * Before joining, the local routes are shifted down by 1/10^destination_ledger_scale
 * to pessimistically account for rounding errors.
 *
 * The "local" tables are used for `findBestHopFor*`.
 * The "public" tables are broadcast to adjacent connectors.
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
