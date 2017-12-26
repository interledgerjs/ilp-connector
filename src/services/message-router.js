'use strict'

const IlpPacket = require('ilp-packet')
const InvalidPacketError = require('../errors/invalid-packet-error')
const Config = require('./config')
const Accounts = require('./accounts')
const RouteBroadcaster = require('./route-broadcaster')
const RouteBuilder = require('./route-builder')
const IlpPrepareController = require('../controllers/ilp-prepare')
const IlqpController = require('../controllers/ilqp')
const JsonController = require('../controllers/json')
const log = require('../common/log').create('message-router')
const { codes } = require('../lib/ilp-errors')

class MessageRouter {
  constructor (deps) {
    this.config = deps(Config)
    this.accounts = deps(Accounts)
    this.routeBroadcaster = deps(RouteBroadcaster)
    this.routeBuilder = deps(RouteBuilder)

    this.ilpPrepareController = deps(IlpPrepareController)
    this.ilqpController = deps(IlqpController)
    this.jsonController = deps(JsonController)
  }

  async handleData (account, data) {
    try {
      switch (data[0]) {
        case IlpPacket.Type.TYPE_ILP_PREPARE:
          return this.ilpPrepareController.handle(account, data)
        case IlpPacket.Type.TYPE_ILQP_LIQUIDITY_REQUEST:
        case IlpPacket.Type.TYPE_ILQP_BY_SOURCE_REQUEST:
        case IlpPacket.Type.TYPE_ILQP_BY_DESTINATION_REQUEST:
          return this.ilqpController.handle(account, data)
        case '{'.charCodeAt(0):
          return this.jsonController.handle(account, JSON.parse(Buffer.from(data, 'utf8')))
        default:
          log.warn('received invalid packet type. source=%s type=%s', account, data[0])
          throw new InvalidPacketError('invalid packet type received. type=' + data[0])
      }
    } catch (e) {
      // Ensure error is an object
      let err = e
      if (!err || typeof err !== 'object') {
        err = new Error('Non-object thrown: ' + e)
      }

      const code = e.ilpErrorCode || codes.F00_BAD_REQUEST

      return IlpPacket.serializeIlpReject({
        code,
        message: err.message || err.name || 'unknown error',
        triggeredBy: account,
        data: Buffer.alloc(0)
      })
    }
  }
}

module.exports = MessageRouter
