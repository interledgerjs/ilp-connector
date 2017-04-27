'use strict'

const co = require('co')
const InvalidBodyError = require('five-bells-shared').InvalidBodyError
const NoAmountSpecifiedError = require('../errors/no-amount-specified-error')
const InvalidAmountSpecifiedError = require('../errors/invalid-amount-specified-error')
const validate = require('./validate').validate
const quoteModel = require('../models/quote')
const log = require('../common/log').create('message-router')

const PEER_LEDGER_PREFIX = 'peer.'

/**
 * @param {Object} opts
 * @param {Config} opts.config
 * @param {Ledgers} opts.ledgers
 * @param {RoutingTables} opts.routingTables
 * @param {RouteBroadcaster} opts.routeBroadcaster
 * @param {RouteBuilder} opts.routeBuilder
 * @param {BalanceCache} opts.balanceCache
 */
function MessageRouter (opts) {
  this.config = opts.config
  this.ledgers = opts.ledgers
  this.routingTables = opts.routingTables
  this.routeBroadcaster = opts.routeBroadcaster
  this.routeBuilder = opts.routeBuilder
  this.balanceCache = opts.balanceCache
}

/**
 * Process an incoming message, and send a response message (if applicable) back to the sender.
 *
 * @param {Message} message
 * @returns {Promise.<null>}
 */
MessageRouter.prototype.handleMessage = function (message) {
  if (!message.data) return Promise.resolve(null)
  return this.handleRequest(message.data, message.from).then(
    (responseData) => {
      if (!responseData) return
      return this.ledgers.getPlugin(message.ledger).sendMessage({
        ledger: message.ledger,
        from: message.to,
        to: message.from,
        data: responseData
      })
    })
}

/**
 * Process the payload of an incoming message.
 * Returns the payload of a response message (if applicable).
 *
 * @param {MessageData} request
 * @param {IlpAddress} sender
 * @returns {Promise.<MessageData>} response
 */
MessageRouter.prototype.handleRequest = function (request, sender) {
  return co.wrap(this._handleRequest).call(this, request, sender)
    .catch((err) => {
      return {
        id: request.id,
        method: 'error',
        data: {
          id: err.name,
          message: err.message
        }
      }
    })
}

/**
 * @param {MessageData} request
 * @param {IlpAddress} sender
 * @returns {MessageData} response
 */
MessageRouter.prototype._handleRequest = function * (request, sender) {
  if (request.method === 'error') {
    log.warn('got error message: ' + JSON.stringify(request.data))
    return
  }

  if (request.method === 'broadcast_routes') {
    yield this.receiveRoutes(request.data, sender)
    return
  }

  if (request.method === 'quote_request') {
    return {
      id: request.id,
      method: 'quote_response',
      data: yield this.getQuote(request.data)
    }
  }

  if (request.method === 'quote_response') {
    // Ignore; this is handled by `ilp-core.Client`.
    return
  }

  log.debug('ignoring unkown request method', request.method)
}

/**
 * Add routes to the local routing table.
 *
 * @param {Route[]} routes
 * @param {IlpAddress} sender
 */
MessageRouter.prototype.receiveRoutes = function * (payload, sender) {
  validate('RoutingUpdate', payload)
  log.debug('receiveRoutes sender:', sender)
  let routes = payload.new_routes

  let holdDownTime = payload.hold_down_time
  this.routingTables.bumpConnector(sender, holdDownTime)
  let potentiallyUnreachableLedgers = payload.unreachable_through_me
  let lostLedgerLinks = []
  if (potentiallyUnreachableLedgers.length > 0) {
    log.info('informed of broken routes to:', potentiallyUnreachableLedgers, ' through:', sender)
    for (const ledger of potentiallyUnreachableLedgers) {
      lostLedgerLinks.push(...this.routingTables.invalidateConnectorsRoutesTo(sender, ledger))
    }
  }

  if (routes.length === 0 && lostLedgerLinks.length === 0) { // just a heartbeat
    log.info('got heartbeat from:', sender)
    return
  }

  let gotNewRoute = false
  for (const route of routes) {
    // We received a route from another connector, but that route
    // doesn't actually belong to the connector, so ignore it.
    if (route.source_account !== sender) continue
    // make sure source_account is on source_ledger:
    if (!route.source_account.startsWith(route.source_ledger)) continue
    // The destination_ledger can be any ledger except one that starts with `peer.`.
    if (route.destination_ledger.startsWith(PEER_LEDGER_PREFIX)) continue
    if (this.routingTables.addRoute(route)) gotNewRoute = true
  }
  log.debug('receiveRoutes sender:', sender, ' provided ', routes.length, ' any new?:', gotNewRoute)

  if ((gotNewRoute || (lostLedgerLinks.length > 0)) &&
      this.config.routeBroadcastEnabled) {
    this.routeBroadcaster.markLedgersUnreachable(lostLedgerLinks)
    co(this.routeBroadcaster.broadcast.bind(this.routeBroadcaster))
      .catch(function (err) {
        log.warn('error broadcasting routes: ' + err.message)
      })
  }
}

/**
 * Handle a quote request.
 *
 * @param {Object} quoteQuery
 * @returns {Promise.<Quote>}
 */
MessageRouter.prototype.getQuote = function (quoteQuery) {
  return co.wrap(this._getQuote).call(this, quoteQuery)
}

MessageRouter.prototype._getQuote = function * (quoteQuery) {
  validateAmounts(quoteQuery.source_amount, quoteQuery.destination_amount)
  if (!quoteQuery.source_address) {
    // TODO use a different error message
    throw new InvalidBodyError('Missing required parameter: source_address')
  }
  if (!quoteQuery.destination_address) {
    throw new InvalidBodyError('Missing required parameter: destination_address')
  }
  return yield quoteModel.getQuote(quoteQuery, this.config, this.routeBuilder, this.balanceCache)
}

function validateAmounts (sourceAmount, destinationAmount) {
  if (sourceAmount && destinationAmount) {
    throw new InvalidBodyError('Exactly one of source_amount or destination_amount must be specified')
  }
  if (!sourceAmount && !destinationAmount) {
    throw new NoAmountSpecifiedError('Exactly one of source_amount or destination_amount must be specified')
  }
  if (sourceAmount) {
    if (isNaN(sourceAmount) || Number(sourceAmount) <= 0 ||
      Number(sourceAmount) === Number.POSITIVE_INFINITY) {
      throw new InvalidAmountSpecifiedError('source_amount must be finite and positive')
    }
  } else if (destinationAmount) {
    if (isNaN(destinationAmount) || Number(destinationAmount) <= 0 ||
      Number(destinationAmount) === Number.POSITIVE_INFINITY) {
      throw new InvalidAmountSpecifiedError('destination_amount must be finite and positive')
    }
  }
}

module.exports = MessageRouter
