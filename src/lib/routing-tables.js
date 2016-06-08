'use strict'

const _ = require('lodash')
const routing = require('five-bells-routing')
const Route = require('./route')
const SIMPLIFY_POINTS = 10
// A next hop of LOCAL distinguishes a local pair A→B from a complex route
// that just happens to be local, i.e. when A→C & C→B are local pairs.
const LOCAL = 'LOCAL'

class RoutingTables {
  constructor (baseURI, localRoutes) {
    this.baseURI = baseURI
    this.sources = {} // { "sourceLedger" => routing.RoutingTable }
    this.accounts = {} // { "connector;ledger" => accountURI }
    this.addLocalRoutes(localRoutes)
  }

  /**
   * @param {Routes} localRoutes - Each local route should include the optional
   *   `destinationAccount` parameter. `connector` should always be `baseURI`.
   */
  addLocalRoutes (_localRoutes) {
    const localRoutes = _localRoutes.map(Route.fromData)
    for (const localRoute of localRoutes) {
      const table = this.sources[localRoute.sourceLedger] ||
        (this.sources[localRoute.sourceLedger] = new routing.RoutingTable())
      table.addRoute(localRoute.destinationLedger, LOCAL, localRoute)
    }
    localRoutes.forEach((route) => this.addRoute(route))
  }

  /**
   * Given a `route` B→C, create a route A→C for each source ledger A with a
   * local route to B.
   *
   * @param {Route|RouteData} _route from ledger B→C
   * @returns {Boolean} whether or not a new route was added
   */
  addRoute (_route) {
    const route = (_route instanceof Route) ? _route : Route.fromData(_route)
    this.accounts[route.connector + ';' + route.sourceLedger] = route.sourceAccount
    if (route.destinationAccount) {
      this.accounts[route.connector + ';' + route.destinationLedger] = route.destinationAccount
    }

    let added = false
    this.eachSource((tableFromA, ledgerA) => {
      added = this._addRouteFromSource(tableFromA, ledgerA, route) || added
    })
    return added
  }

  _addRouteFromSource (tableFromA, ledgerA, routeFromBToC) {
    const ledgerB = routeFromBToC.sourceLedger
    const ledgerC = routeFromBToC.destinationLedger
    const connectorFromBToC = routeFromBToC.connector
    let added = false

    // Don't create local route A→B→C if local route A→C already exists.
    if (this.baseURI === connectorFromBToC && this._getLocalRoute(ledgerA, ledgerC)) return
    // Don't create A→B→C when A→B is not a local pair.
    const routeFromAToB = this._getLocalRoute(ledgerA, ledgerB)
    if (!routeFromAToB) return

    // Make sure the routes can be joined.
    const routeFromAToC = routeFromAToB.join(routeFromBToC)
    if (!routeFromAToC) return

    if (!this._getRoute(ledgerA, ledgerC, connectorFromBToC)) added = true
    tableFromA.addRoute(ledgerC, connectorFromBToC, routeFromAToC)

    // Given pairs A↔B,B→C; on addRoute(C→D) create A→D after creating B→D.
    if (added) added = this.addRoute(routeFromAToC) || added
    return added
  }

  _removeRoute (ledgerB, ledgerC, connectorFromBToC) {
    this.eachSource((tableFromA, ledgerA) => {
      tableFromA.removeRoute(ledgerC, connectorFromBToC)
    })
  }

  removeExpiredRoutes () {
    this.eachRoute((routeFromAToB, ledgerA, ledgerB, nextHop) => {
      if (routeFromAToB.isExpired()) {
        this._removeRoute(ledgerA, ledgerB, nextHop)
      }
    })
  }

  /**
   * @param {function(tableFromA, ledgerA)} fn
   */
  eachSource (fn) { _.forEach(this.sources, fn) }

  /**
   * @param {function(routeFromAToB, ledgerA, ledgerB, nextHop)} fn
   */
  eachRoute (fn) {
    this.eachSource((tableFromA, ledgerA) => {
      for (const ledgerB of tableFromA.destinations.keys()) {
        const routesFromAToB = tableFromA.destinations.get(ledgerB)
        for (const nextHop of routesFromAToB.keys()) {
          const routeFromAToB = routesFromAToB.get(nextHop)
          fn(routeFromAToB, ledgerA, ledgerB, nextHop)
        }
      }
    })
  }

  /**
   * @returns {Routes}
   */
  toJSON () {
    const routes = []
    this.eachSource((table, sourceLedger) => {
      for (const destinationLedger of table.destinations.keys()) {
        const routesByConnector = table.destinations.get(destinationLedger)
        const combinedRoute = combineRoutesByConnector(routesByConnector)
        const sourceAccount = this._getAccount(this.baseURI, sourceLedger)
        routes.push(combinedRoute.toData(this.baseURI, sourceAccount))
      }
    })
    return routes
  }

  _getAccount (connector, ledger) {
    return this.accounts[connector + ';' + ledger]
  }

  _getLocalRoute (ledgerA, ledgerB) {
    return this._getRoute(ledgerA, ledgerB, LOCAL)
  }

  _getRoute (ledgerA, ledgerB, connector) {
    const routesFromAToB = this.sources[ledgerA].destinations.get(ledgerB)
    if (!routesFromAToB) return
    return routesFromAToB.get(connector)
  }

  /**
   * Find the best intermediate ledger (`ledgerB`) to use after `ledgerA` on
   * the way to `ledgerC`.
   * This connector must have `[ledgerA, ledgerB]` as a pair.
   *
   * @param {URI} ledgerA
   * @param {URI} ledgerC
   * @param {String} finalAmount
   * @returns {Object}
   */
  findBestHopForDestinationAmount (ledgerA, ledgerC, finalAmount) {
    const nextHop = this._findBestHopForDestinationAmount(ledgerA, ledgerC, +finalAmount)
    if (!nextHop) return
    const ledgerB = nextHop.bestRoute.nextLedger
    const routeFromAToB = this._getLocalRoute(ledgerA, ledgerB)
<<<<<<< 3751b2e746060ff1ff33357c9941ca3a88242c24
    const isLocal = this.baseURI === nextHop.bestHop

=======
    const isFinal = ledgerB === ledgerC
>>>>>>> [FIX] Fix demo routing (rounding); slippage=0
    return {
      isFinal: isFinal,
      connector: nextHop.bestHop,
      sourceLedger: ledgerA,
      sourceAmount: nextHop.bestCost.toString(),
      destinationLedger: ledgerB,
      destinationAmount: routeFromAToB.amountAt(nextHop.bestCost).toString(),
      destinationCreditAccount: isFinal ? null : this._getAccount(nextHop.bestHop, ledgerB),
      finalLedger: ledgerC,
      finalAmount: finalAmount,
<<<<<<< 3751b2e746060ff1ff33357c9941ca3a88242c24
      minMessageWindow: nextHop.info.minMessageWindow,
      additionalInfo: isLocal ? routeFromAToB.info.additional_info : undefined
=======
      minMessageWindow: nextHop.bestRoute.minMessageWindow
>>>>>>> [FIX] Fix demo routing (rounding); slippage=0
    }
  }

  /**
   * @param {URI} ledgerA
   * @param {URI} ledgerC
   * @param {String} sourceAmount
   * @returns {Object}
   */
  findBestHopForSourceAmount (ledgerA, ledgerC, sourceAmount) {
    const nextHop = this._findBestHopForSourceAmount(ledgerA, ledgerC, +sourceAmount)
    if (!nextHop) return
    const ledgerB = nextHop.bestRoute.nextLedger
    const routeFromAToB = this._getLocalRoute(ledgerA, ledgerB)
<<<<<<< 3751b2e746060ff1ff33357c9941ca3a88242c24
    const isLocal = this.baseURI === nextHop.bestHop

=======
    const isFinal = ledgerB === ledgerC
>>>>>>> [FIX] Fix demo routing (rounding); slippage=0
    return {
      isFinal: isFinal,
      connector: nextHop.bestHop,
      sourceLedger: ledgerA,
      sourceAmount: sourceAmount,
      destinationLedger: ledgerB,
      destinationAmount: routeFromAToB.amountAt(+sourceAmount).toString(),
      destinationCreditAccount: isFinal ? null : this._getAccount(nextHop.bestHop, ledgerB),
      finalLedger: ledgerC,
      finalAmount: nextHop.bestValue.toString(),
<<<<<<< 3751b2e746060ff1ff33357c9941ca3a88242c24
      minMessageWindow: nextHop.info.minMessageWindow,
      additionalInfo: isLocal ? routeFromAToB.info.additional_info : undefined
=======
      minMessageWindow: nextHop.bestRoute.minMessageWindow
>>>>>>> [FIX] Fix demo routing (rounding); slippage=0
    }
  }

  _findBestHopForSourceAmount (source, destination, amount) {
    if (!this.sources[source]) return
    return this._rewriteLocalHop(
      this.sources[source].findBestHopForSourceAmount(destination, amount))
  }

  _findBestHopForDestinationAmount (source, destination, amount) {
    if (!this.sources[source]) return
    return this._rewriteLocalHop(
      this.sources[source].findBestHopForDestinationAmount(destination, amount))
  }

  _rewriteLocalHop (hop) {
    if (hop && hop.bestHop === LOCAL) hop.bestHop = this.baseURI
    return hop
  }
}

function combineRoutesByConnector (routesByConnector) {
  const routes = routesByConnector.values()
  let totalRoute = routes.next().value
  for (const subRoute of routes) {
    totalRoute = totalRoute.combine(subRoute)
  }
  return totalRoute.simplify(SIMPLIFY_POINTS)
}

module.exports = RoutingTables
