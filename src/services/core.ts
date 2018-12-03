import reduct = require('reduct')
import { IlpReply, IlpPrepare } from 'ilp-packet'
import Config from '../services/config'
import Accounts from '../services/accounts'
import IlpPrepareController from '../controllers/ilp-prepare'
import { create as createLogger } from '../common/log'
const log = createLogger('core-middleware')

export default class Core {
  protected config: Config
  protected accounts: Accounts
  protected handler: (packet: IlpPrepare, sourceAccount: string, outbound: (data: IlpPrepare, accountId: string) => Promise<IlpReply>) => Promise<IlpReply>

  constructor (deps: reduct.Injector) {
    this.config = deps(Config)
    this.accounts = deps(Accounts)

    switch (this.config.profile) {
      case 'cluster':
      case 'connector':
        const controller = deps(IlpPrepareController)
        this.handler = async (packet: IlpPrepare, sourceAccount: string,
          outbound: (data: IlpPrepare, accountId: string) => Promise<IlpReply>) => {
          return controller.sendIlpPacket(packet, sourceAccount, outbound)
        }
        break
      case 'plugin':
        this.handler = async (packet: IlpPrepare, sourceAccount: string,
          outbound: (data: IlpPrepare, accountId: string) => Promise<IlpReply>) => {
          return outbound(packet, 'parent')
        }
        break
      default:
        throw new Error(`Unknown configuration profile: ${this.config.profile}`)
    }

  }

  /**
   * This fucntion is invoked at the end of the incoming middleware pipeline.
   * Calling 'outbound' invokes the outbound middleware pipeline.
   *
   * @param packet The incoming ILP packet
   * @param sourceAccountId The account id of the account that is the origin of the packet
   * @param outbound The callback to send the outbound ILP packet and get the response
   */
  public async processIlpPacket (packet: IlpPrepare, sourceAccountId: string, outbound: (packet: IlpPrepare, destAccountId: string) => Promise<IlpReply>): Promise<IlpReply> {
    if (!this.accounts.get(sourceAccountId)) {
      log.warn('got data from unknown account id. accountId=%s', sourceAccountId)
      throw new Error('got data from unknown account id. accountId=' + sourceAccountId)
    }

    return this.handler(packet, sourceAccountId, outbound)

  }

}
