'use strict'

const IlpPacket = require('ilp-packet')
const InvalidBodyError = require('five-bells-shared').InvalidBodyError
const IlpError = require('../errors/ilp-error')
const validate = require('./validate').validate
const LiquidityCurve = require('../routing/liquidity-curve')
const log = require('../common/log').create('message-router')

/**
 * @param {Object} opts
 * @param {Config} opts.config
 * @param {Accounts} opts.accounts
 * @param {RouteBroadcaster} opts.routeBroadcaster
 * @param {RouteBuilder} opts.routeBuilder
 */
function MessageRouter (opts) {
  this.config = opts.config
  this.accounts = opts.accounts
  this.routeBroadcaster = opts.routeBroadcaster
  this.routeBuilder = opts.routeBuilder
  this.accounts.registerInternalRequestHandler(this.handleRequest.bind(this))
}

/**
 * Process an incoming message, and send a response message (if applicable) back to the sender.
 *
 * @param {RequestMessage} requestMessage
 * @returns {Promise.<ResponseMessage>}
 */
MessageRouter.prototype.handleRequest = async function (requestMessage) {
  if (!requestMessage.ilp && !requestMessage.custom) {
    throw new Error('Invalid request message')
  }

  try {
    return await this._handleRequest(requestMessage)
  } catch (err) {
    log.warn('error while handling request.', err.stack)
    if (!(err instanceof IlpError)) {
      throw err
    }
    return {
      ledger: requestMessage.ledger,
      from: requestMessage.to,
      to: requestMessage.from,
      ilp: IlpPacket.serializeIlpError(Object.assign({}, err.packet, {
        forwardedBy: err.packet.forwardedBy.concat(requestMessage.to)
      }))
    }
  }
}

/**
 * @param {RequestMessage} request
 * @returns {ResponseMessage} response
 */
MessageRouter.prototype._handleRequest = async function (request) {
  if (request.ilp) {
    const responsePacket = await this._handleRequestByPacket(
      Buffer.from(request.ilp, 'base64'), request.from)
    return {
      ledger: request.ledger,
      from: request.to,
      to: request.from,
      ilp: responsePacket.toString('base64')
    }
  }

  if (request.custom.method === 'broadcast_routes') {
    await this.receiveRoutes(request.custom.data, request.from)
    return {
      ledger: request.ledger,
      from: request.to,
      to: request.from
    }
  }

  log.warn('ignoring unkown request method', request.custom.method)
}

MessageRouter.prototype._handleRequestByPacket = async function (packet, sender) {
  const packetData = Object.assign(
    {sourceAccount: sender},
    IlpPacket.deserializeIlpPacket(packet).data)
  switch (packet[0]) {
    case IlpPacket.Type.TYPE_ILQP_LIQUIDITY_REQUEST:
      return IlpPacket.serializeIlqpLiquidityResponse(
        await this.routeBuilder.quoteLiquidity(packetData))
    case IlpPacket.Type.TYPE_ILQP_BY_SOURCE_REQUEST:
      return IlpPacket.serializeIlqpBySourceResponse(
        await this.routeBuilder.quoteBySource(packetData))
    case IlpPacket.Type.TYPE_ILQP_BY_DESTINATION_REQUEST:
      return IlpPacket.serializeIlqpByDestinationResponse(
        await this.routeBuilder.quoteByDestination(packetData))
    default:
      throw new InvalidBodyError('Packet has unexpected type')
  }
}

/**
 * Add routes to the local routing table.
 *
 * @param {Route[]} routes
 * @param {IlpAddress} sender
 */
MessageRouter.prototype.receiveRoutes = async function (payload, sender) {
  validate('RoutingUpdate', payload)
  log.debug('received routes. sender=%s', sender)

  const routeUpdate = {
    newRoutes: payload.new_routes.map(route => (
      route.source_ledger !== route.source_account
      ? null
      : {
        peer: sender,
        prefix: route.target_prefix || route.destination_ledger,
        distance: Math.max(route.paths && route.paths[0] && route.paths[0].length || 1, 1),
        curve: route.points && new LiquidityCurve(route.points),
        minMessageWindow: route.min_message_window * 1000
      }
    )).filter(Boolean),
    unreachableThroughMe: payload.unreachable_through_me,
    holdDownTime: payload.hold_down_time,
    requestFullTable: payload.request_full_table
  }

  this.routeBroadcaster.handleRouteUpdate(sender, routeUpdate)
}

module.exports = MessageRouter
