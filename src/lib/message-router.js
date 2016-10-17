'use strict'

const co = require('co')
const InvalidBodyError = require('five-bells-shared').InvalidBodyError
const NoAmountSpecifiedError = require('../errors/no-amount-specified-error')
const InvalidAmountSpecifiedError = require('../errors/invalid-amount-specified-error')
const validate = require('./validate').validate
const quoteModel = require('../models/quote')
const log = require('../common/log').create('message-router')

/**
 * @param {Object} opts
 * @param {Config} opts.config
 * @param {ilp.Core} opts.core
 * @param {RoutingTables} opts.routingTables
 * @param {RouteBroadcaster} opts.routeBroadcaster
 * @param {RouteBuilder} opts.routeBuilder
 * @param {BalanceCache} opts.balanceCache
 */
function MessageRouter (opts) {
  this.config = opts.config
  this.core = opts.core
  this.routingTables = opts.routingTables
  this.routeBroadcaster = opts.routeBroadcaster
  this.routeBuilder = opts.routeBuilder
  this.balanceCache = opts.balanceCache
}

MessageRouter.prototype.handleMessage = function (message) {
  if (!message.data) return Promise.resolve(null)
  return this.handleRequest(message.data).then(
    (responseData) => {
      if (!responseData) return
      return this.core.getPlugin(message.ledger).sendMessage({
        ledger: message.ledger,
        account: message.account,
        data: responseData
      })
    })
}

MessageRouter.prototype.handleRequest = function (request) {
  return co.wrap(this._handleRequest).call(this, request)
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

MessageRouter.prototype._handleRequest = function * (request) {
  if (request.method === 'error') {
    log.warn('got error message: ' + JSON.stringify(request.data))
    return
  }

  if (request.method === 'broadcast_routes') {
    yield this.receiveRoutes(request.data)
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

  throw new InvalidBodyError('Invalid method')
}

MessageRouter.prototype.receiveRoutes = function * (routes) {
  validate('Routes', routes)
  let gotNewRoute = false

  // TODO verify that the sender of these routes matches route.source_account.
  for (const route of routes) {
    if (this.routingTables.addRoute(route)) gotNewRoute = true
  }

  if (gotNewRoute && this.config.routeBroadcastEnabled) {
    co(this.routeBroadcaster.broadcast.bind(this.routeBroadcaster))
      .catch(function (err) {
        log.warn('error broadcasting routes: ' + err.message)
      })
  }
}

MessageRouter.prototype.getQuote = function (quoteQuery) {
  return co.wrap(this._getQuote).call(this, quoteQuery)
}

MessageRouter.prototype._getQuote = function * (quoteQuery) {
  validateAmounts(quoteQuery.source_amount, quoteQuery.destination_amount)
  validatePrecisionAndScale(quoteQuery.destination_precision, quoteQuery.destination_scale)
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

function validatePrecisionAndScale (precision, scale) {
  if (precision && scale) return
  if (!precision && !scale) return
  throw new InvalidBodyError('Either both or neither of "precision" and "scale" must be specified')
}

module.exports = MessageRouter
