'use strict'

const _ = require('lodash')
const routing = require('five-bells-routing')
const ROUTE_EXPIRY = 45 * 1000 // milliseconds
const SIMPLIFY_POINTS = 10

class RoutingTables {
  constructor (baseURI, localRoutes) {
    this.baseURI = baseURI
    this.sources = {} // { "sourceLedger" => routing.RoutingTable }
    this.accounts = {} // { "connector;ledger" => accountURI }
    this.addLocalRoutes(localRoutes)
  }

  /**
   * @param {Routes} localRoutes - Each local route should include the optional
   *   `destination_account` parameter. `connector` should always be `baseURI`.
   */
  addLocalRoutes (localRoutes) {
    for (const localRoute of localRoutes) {
      const table = this.sources[localRoute.source_ledger] ||
        (this.sources[localRoute.source_ledger] = new routing.RoutingTable())
      const route = new routing.Route(localRoute.points, {
        minMessageWindow: localRoute.min_message_window,
        nextLedger: localRoute.destination_ledger
      })
      table.addRoute(localRoute.destination_ledger, this.baseURI, route)
    }
    localRoutes.forEach(this.addRoute, this)
  }

  /**
   * Given a `route` B→C, create a route A→C for each source ledger A with a
   * local route to B.
   *
   * @param {Route} route from ledger B→C
   */
  addRoute (route) {
    const ledgerB = route.source_ledger
    const ledgerC = route.destination_ledger
    const connectorFromBToC = route.connector
    const routeFromBToC = new routing.Route(route.points)

    this.accounts[connectorFromBToC + ';' + ledgerB] = route.source_account
    if (route.destination_account) {
      this.accounts[connectorFromBToC + ';' + ledgerC] = route.destination_account
    }

    this.eachSource((tableFromA, ledgerA) => {
      // Don't create A→B→A.
      if (ledgerA === ledgerC) return
      // Don't create local route A→B→C if local route A→C already exists.
      if (this.baseURI === connectorFromBToC && this._getLocalRoute(ledgerA, ledgerC)) return
      // Don't create A→B→C when A→B is not a local pair.
      const routeFromAToB = this._getLocalRoute(ledgerA, ledgerB)
      if (!routeFromAToB) return
      const routeFromAToC = routeFromAToB.join(routeFromBToC)
      routeFromAToC.info = makeRouteInfo(route, routeFromAToB.info.minMessageWindow)
      tableFromA.addRoute(ledgerC, connectorFromBToC, routeFromAToC)
    })
  }

  _removeRoute (ledgerB, ledgerC, connectorFromBToC) {
    this.eachSource((tableFromA, ledgerA) => {
      tableFromA.removeRoute(ledgerC, connectorFromBToC)
    })
  }

  removeExpiredRoutes () {
    const now = Date.now()
    this.eachRoute((routeFromAToB, ledgerA, ledgerB, nextHop) => {
      if (routeFromAToB.info.expiresAt && routeFromAToB.info.expiresAt < now) {
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
        routes.push({
          source_ledger: sourceLedger,
          destination_ledger: destinationLedger,
          connector: this.baseURI,
          points: combinedRoute.getPoints(),
          min_message_window: combinedRoute.info.minMessageWindow,
          source_account: this._getAccount(this.baseURI, sourceLedger)
        })
      }
    })
    return routes
  }

  _getAccount (connector, ledger) {
    return this.accounts[connector + ';' + ledger]
  }

  _getLocalRoute (ledgerA, ledgerB) {
    const routesFromAToB = this.sources[ledgerA].destinations.get(ledgerB)
    if (!routesFromAToB) return
    return routesFromAToB.get(this.baseURI)
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
    const ledgerB = nextHop.info.nextLedger
    const routeFromAToB = this._getLocalRoute(ledgerA, ledgerB)
    const isLocal = this.baseURI === nextHop.bestHop
    return {
      connector: nextHop.bestHop,
      sourceLedger: ledgerA,
      // Prevent 'BigNumber Error: new BigNumber() number type has more than 15 significant digits'
      sourceAmount: nextHop.bestCost.toString(),
      destinationLedger: ledgerB,
      destinationAmount: routeFromAToB.amountAt(nextHop.bestCost).toString(),
      destinationDebitAccount: this._getAccount(this.baseURI, ledgerB),
      destinationCreditAccount: isLocal ? null : this._getAccount(nextHop.bestHop, ledgerB),
      finalLedger: ledgerC,
      finalAmount: finalAmount,
      minMessageWindow: nextHop.info.minMessageWindow
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
    const ledgerB = nextHop.info.nextLedger
    const routeFromAToB = this._getLocalRoute(ledgerA, ledgerB)
    const isLocal = this.baseURI === nextHop.bestHop
    return {
      connector: nextHop.bestHop,
      sourceLedger: ledgerA,
      sourceAmount: sourceAmount,
      destinationLedger: ledgerB,
      destinationAmount: routeFromAToB.amountAt(sourceAmount).toString(),
      destinationDebitAccount: this._getAccount(this.baseURI, ledgerB),
      destinationCreditAccount: isLocal ? null : this._getAccount(nextHop.bestHop, ledgerB),
      finalLedger: ledgerC,
      finalAmount: nextHop.bestValue.toString(),
      minMessageWindow: nextHop.info.minMessageWindow
    }
  }

  _findBestHopForSourceAmount (source, destination, amount) {
    if (!this.sources[source]) return
    return this.sources[source].findBestHopForSourceAmount(destination, amount)
  }

  _findBestHopForDestinationAmount (source, destination, amount) {
    if (!this.sources[source]) return
    return this.sources[source].findBestHopForDestinationAmount(destination, amount)
  }
}

function combineRoutesByConnector (routesByConnector) {
  let totalRoute = new routing.Route([])
  const info = {minMessageWindow: 0}
  for (const subRoute of routesByConnector.values()) {
    totalRoute = totalRoute.combine(subRoute)
    if (info.minMessageWindow < subRoute.info.minMessageWindow) {
      info.minMessageWindow = subRoute.info.minMessageWindow
    }
  }
  totalRoute.info = info
  return totalRoute.simplify(SIMPLIFY_POINTS)
}

function makeRouteInfo (route, minMessageWindow) {
  return {
    minMessageWindow: route.min_message_window + minMessageWindow,
    expiresAt: Date.now() + ROUTE_EXPIRY,
    nextLedger: route.source_ledger
  }
}

module.exports = RoutingTables
