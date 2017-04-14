'use strict'
const routing = require('ilp-routing')

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
  /**
   * @param {Object} config
   * @param {String} config.backend
   * @param {Integer} config.expiryDuration
   * @param {Number} config.fxSpread
   * @param {Number} config.slippage
   */
  constructor (config) {
    this.isTrivialRate =
      config.backend === 'one-to-one' &&
      config.fxSpread === 0 &&
      config.slippage === 0
    this.localTables = new routing.RoutingTables([], config.expiryDuration)
    this.publicTables = new routing.RoutingTables([], config.expiryDuration)
  }

  addLocalRoutes (ledgers, _localRoutes) {
    const localRoutes = _localRoutes.map(routing.Route.fromData)
    this.localTables.addLocalRoutes(localRoutes)

    // Shift the graph down by a small amount so that precision rounding doesn't
    // cause UnacceptableRateErrors.
    for (const localRoute of localRoutes) {
      const destinationAdjustment = this._getScaleAdjustment(
        ledgers, localRoute.sourceLedger, localRoute.destinationLedger)
      const shiftedLocalRoute = destinationAdjustment
        ? localRoute.shiftY(-destinationAdjustment)
        : localRoute
      this.publicTables.addLocalRoutes([shiftedLocalRoute])
    }
  }

  addRoute (route, noExpire) {
    this.localTables.addRoute(route, noExpire)
    return this.publicTables.addRoute(route, noExpire)
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

  toDebugStrings () {
    return this.publicTables.toDebugStrings()
  }

  removeLedger (ledger) {
    this.localTables.removeLedger(ledger)
    this.publicTables.removeLedger(ledger)
  }

  removeExpiredRoutes () {
    this.localTables.removeExpiredRoutes()
    let removedRoutes = this.publicTables.removeExpiredRoutes()
    return removedRoutes
  }

  bumpConnector (connectorAccount, holdDownTime) {
    this.localTables.bumpConnector(connectorAccount, holdDownTime)
    this.publicTables.bumpConnector(connectorAccount, holdDownTime)
  }

  invalidateConnector (connectorAccount) {
    this.localTables.invalidateConnector(connectorAccount)
    return this.publicTables.invalidateConnector(connectorAccount)
  }

  invalidateConnectorsRoutesTo (connectorAccount, ledger) {
    this.localTables.invalidateConnectorsRoutesTo(connectorAccount, ledger)
    return this.publicTables.invalidateConnectorsRoutesTo(connectorAccount, ledger)
  }

  _getScaleAdjustment (ledgers, sourceLedger, destinationLedger) {
    const sourceScale = ledgers.getPlugin(sourceLedger).getInfo().currencyScale
    const destinationScale = ledgers.getPlugin(destinationLedger).getInfo().currencyScale
    if (sourceScale === destinationScale && this.isTrivialRate) return 0
    const destinationAdjustment = destinationScale ? Math.pow(10, -destinationScale) : 0
    return destinationAdjustment
  }
}

module.exports = RoutingTables
