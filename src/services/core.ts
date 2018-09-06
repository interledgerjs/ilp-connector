import * as IlpPacket from 'ilp-packet'
import Config from '../services/config'
import Accounts from '../services/accounts'
import RouteBroadcaster from '../services/route-broadcaster'
import RouteBuilder from '../services/route-builder'
import IlpPrepareController from '../controllers/ilp-prepare'
import { create as createLogger } from '../common/log'
const log = createLogger('core-middleware')
import reduct = require('reduct')
const { InvalidPacketError } = IlpPacket.Errors

export default class Core {
  protected config: Config
  protected accounts: Accounts
  protected routeBroadcaster: RouteBroadcaster
  protected routeBuilder: RouteBuilder
  protected ilpPrepareController: IlpPrepareController

  constructor (deps: reduct.Injector) {
    this.config = deps(Config)
    this.accounts = deps(Accounts)
    this.routeBroadcaster = deps(RouteBroadcaster)
    this.routeBuilder = deps(RouteBuilder)

    this.ilpPrepareController = deps(IlpPrepareController)
  }

  async processData (data: Buffer, accountId: string, outbound: (data: Buffer, accountId: string) => Promise<Buffer>): Promise<Buffer> {
    if (!this.accounts.getInfo(accountId)) {
      log.warn('got data from unknown account id. accountId=%s', accountId)
      throw new Error('got data from unknown account id. accountId=' + accountId)
    }

    if (!Buffer.isBuffer(data)) {
      log.error('data handler was passed a non-buffer. typeof=%s data=%s', typeof data, data)
      throw new Error('data handler was passed a non-buffer. typeof=' + typeof data)
    }

    switch (data[0]) {
      case IlpPacket.Type.TYPE_ILP_PREPARE:
        return this.ilpPrepareController.sendData(data, accountId, outbound)
      default:
        log.error('received invalid packet type. source=%s type=%s', accountId, data[0])
        throw new InvalidPacketError('invalid packet type received. type=' + data[0])
    }
  }
}
