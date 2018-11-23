import { IlpReply, IlpPrepare } from 'ilp-packet'
import Config from '../services/config'
import Accounts from '../services/accounts'
import RouteBroadcaster from '../services/route-broadcaster'
import RouteBuilder from '../services/route-builder'
import IlpPrepareController from '../controllers/ilp-prepare'
import { create as createLogger } from '../common/log'
const log = createLogger('core-middleware')
import reduct = require('reduct')

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

  async processIlpPacket (packet: IlpPrepare, accountId: string, outbound: (packet: IlpPrepare, accountId: string) => Promise<IlpReply>): Promise<IlpReply> {
    if (!this.accounts.getInfo(accountId)) {
      log.warn('got data from unknown account id. accountId=%s', accountId)
      throw new Error('got data from unknown account id. accountId=' + accountId)
    }

    return this.ilpPrepareController.sendIlpPacket(packet, accountId, outbound)
  }
}
