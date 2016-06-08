'use strict'

const routing = require('five-bells-routing')
const ROUTE_EXPIRY = 45 * 1000 // milliseconds

class Route extends routing.Route {
  /**
   * @param {Point[]} points
   * @param {Object} params
   * @param {String[]} params.hops (required)
   * @param {Number} params.minMessageWindow
   * @param {Number} params.expiresAt
   * @param {String} params.sourceAccount
   * @param {String} params.destinationAccount
   */
  constructor (points, params) {
    super(points)
    this.minMessageWindow = params.minMessageWindow
    this.expiresAt = params.expiresAt

    this.connector = params.connector
    this.sourceAccount = params.sourceAccount
    this.destinationAccount = params.destinationAccount
    this.hops = params.hops

    this.sourceLedger = this.hops[0]
    this.nextLedger = this.hops[1]
    this.destinationLedger = this.hops[this.hops.length - 1]
  }

  static fromData (data) {
    return new Route(data.points, {
      connector: data.connector,
      sourceAccount: data.source_account,
      destinationAccount: data.destination_account,
      minMessageWindow: data.min_message_window,
      hops: [data.source_ledger, data.destination_ledger]
    })
  }

  toData (connector, sourceAccount) {
    return {
      source_ledger: this.sourceLedger,
      destination_ledger: this.destinationLedger,
      connector: connector,
      points: this.points,
      min_message_window: this.minMessageWindow,
      source_account: sourceAccount
    }
  }

  combine (alternateRoute) {
    return new Route(super.combine(alternateRoute).points, {
      hops: this._simpleHops(),
      minMessageWindow: Math.max(this.minMessageWindow, alternateRoute.minMessageWindow)
    })
  }

  join (tailRoute) {
    // Sanity check: make sure the routes are actually adjacent.
    if (this.destinationLedger !== tailRoute.sourceLedger) return

    // Don't create A→B→A.
    // In addition, ensure that it doesn't double back, i.e. B→A→B→C.
    if (intersect(this.hops, tailRoute.hops) > 1) return

    return new Route(super.join(tailRoute).points, {
      connector: this.connector,
      sourceAccount: this.sourceAccount,
      minMessageWindow: this.minMessageWindow + tailRoute.minMessageWindow,
      hops: this.hops.concat(tailRoute.hops.slice(1)),
      expiresAt: Date.now() + ROUTE_EXPIRY
    })
  }

  simplify (maxPoints) {
    return new Route(super.simplify(maxPoints).points, {
      hops: this._simpleHops(),
      minMessageWindow: this.minMessageWindow
    })
  }

  /**
   * @returns {Boolean}
   */
  isExpired () {
    return this.expiresAt && this.expiresAt < Date.now()
  }

  _simpleHops () {
    return [this.sourceLedger, this.destinationLedger]
  }
}

/**
 * @param {Array} listA
 * @param {Array} listB
 * @returns {Integer} the number of items that listA and listB share
 */
function intersect (listA, listB) {
  let common = 0
  for (const itemA of listA) {
    if (listB.indexOf(itemA) !== -1) common++
  }
  return common
}

module.exports = Route
