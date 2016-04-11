'use strict'

const routing = require('five-bells-routing')
const ROUTE_EXPIRY = 45 * 1000 // milliseconds

class RoutingTables {
  constructor (baseURI, pairs, localRoutes) {
    this.baseURI = baseURI
    this.sources = {}
    this.expiries = {} // { "sourceLedger;destinationLedger;nextHop" => expires_at }
    for (const pair of pairs) {
      let table = this.sources[pair[0]]
      if (!table) {
        table = this.sources[pair[0]] = new routing.RoutingTable()
      }
      table.addRoute(pair[1], baseURI,
        new routing.Route(localRoutes[pair.join(';')]))
    }
  }

  addRoute (ledgerB, ledgerC, connectorFromBToC, routeFromBToC) {
    this.expiries[ledgerB + ';' + ledgerC + ';' + connectorFromBToC] = Date.now() + ROUTE_EXPIRY

    // Override local pairs.
    if (this.sources[ledgerB]) {
      this.sources[ledgerB].addRoute(ledgerC, connectorFromBToC, routeFromBToC)
    }

    for (const ledgerA in this.sources) {
      const tableFromA = this.sources[ledgerA]
      const routesFromAToB = tableFromA.destinations.get(ledgerB)
      if (!routesFromAToB) continue
      tableFromA.addRoute(ledgerC, connectorFromBToC,
        combineRoutesByConnector(routesFromAToB).join(routeFromBToC))
    }
  }

  removeRoute (ledgerB, ledgerC, connectorFromBToC) {
    if (this.sources[ledgerB]) {
      this.sources[ledgerB].removeRoute(ledgerC, connectorFromBToC)
    }

    for (const ledgerA in this.sources) {
      const tableFromA = this.sources[ledgerA]
      const routesFromAToB = tableFromA.destinations.get(ledgerB)
      if (!routesFromAToB) continue
      tableFromA.removeRoute(ledgerC, connectorFromBToC)
    }
  }

  findBestHopForSourceAmount (source, destination, sourceAmount) {
    return this.sources[source].findBestHopForSourceAmount(destination, sourceAmount)
  }

  findBestHopForDestinationAmount (source, destination, destinationAmount) {
    return this.sources[source].findBestHopForDestinationAmount(destination, destinationAmount)
  }

  removeExpiredRoutes () {
    const now = Date.now()
    for (const key in this.expiries) {
      if (this.expiries[key] < now) {
        const keyParts = key.split(';')
        this.removeRoute(keyParts[0], keyParts[1], keyParts[2])
        delete this.expiries[key]
      }
    }
  }

  toJSON () {
    const routes = []
    for (const sourceLedger in this.sources) {
      const table = this.sources[sourceLedger]
      for (const destinationLedger of table.destinations.keys()) {
        const routesByConnector = table.destinations.get(destinationLedger)
        routes.push({
          source_ledger: sourceLedger,
          destination_ledger: destinationLedger,
          connector: this.baseURI,
          points: combineRoutesByConnector(routesByConnector).getPoints()
        })
      }
    }
    return routes
  }
}

function combineRoutesByConnector (routesByConnector) {
  let totalRoute = new routing.Route([])
  for (const subRoute of routesByConnector.values()) {
    totalRoute = totalRoute.combine(subRoute)
  }
  return totalRoute.simplify(10)
}

module.exports = RoutingTables
