'use strict'

import * as IlpPacket from 'ilp-packet'
import InvalidPacketError from '../errors/invalid-packet-error'
import Config from './config'
import Accounts from './accounts'
import RouteBroadcaster from './route-broadcaster'
import RouteBuilder from './route-builder'
import IlpPrepareController from '../controllers/ilp-prepare'
import IlqpController from '../controllers/ilqp'
import JsonController from '../controllers/json'
import { create as createLogger } from '../common/log'
const log = createLogger('message-router')
import { codes } from '../lib/ilp-errors'
import reduct = require('reduct')

export default class MessageRouter {
  protected config: Config
  protected accounts: Accounts
  protected routeBroadcaster: RouteBroadcaster
  protected routeBuilder: RouteBuilder
  protected ilpPrepareController: IlpPrepareController
  protected ilqpController: IlqpController
  protected jsonController: JsonController

  constructor (deps: reduct.Injector) {
    this.config = deps(Config)
    this.accounts = deps(Accounts)
    this.routeBroadcaster = deps(RouteBroadcaster)
    this.routeBuilder = deps(RouteBuilder)

    this.ilpPrepareController = deps(IlpPrepareController)
    this.ilqpController = deps(IlqpController)
    this.jsonController = deps(JsonController)
  }

  async handleData (account: string, data: Buffer) {
    if (!this.accounts.getInfo(account)) {
      log.warn('got data from unknown account id. accountId=%s', account)
      throw new Error('got data from unknown account id. accountId=' + account)
    }

    if (!Buffer.isBuffer(data)) {
      log.warn('data handler was passed a non-buffer. typeof=%s data=%s', typeof data, data)
      throw new Error('data handler was passed a non-buffer. typeof=' + typeof data)
    }

    switch (data[0]) {
      case IlpPacket.Type.TYPE_ILP_PREPARE:
        return this.ilpPrepareController.handle(account, data)
      case IlpPacket.Type.TYPE_ILQP_LIQUIDITY_REQUEST:
      case IlpPacket.Type.TYPE_ILQP_BY_SOURCE_REQUEST:
      case IlpPacket.Type.TYPE_ILQP_BY_DESTINATION_REQUEST:
        return this.ilqpController.handle(account, data)
      case '{'.charCodeAt(0):
        return this.jsonController.handle(account, JSON.parse(data.toString('utf8')))
      default:
        log.warn('received invalid packet type. source=%s type=%s', account, data[0])
        throw new InvalidPacketError('invalid packet type received. type=' + data[0])
    }
  }
}
