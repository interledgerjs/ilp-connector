import * as reduct from 'reduct'
import { create as createLogger } from '../common/log'
import { IlpPrepare, IlpReply, errorToIlpReject } from 'ilp-packet'
import Middleware, { MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'
import Account from '../types/account'
import Accounts from '../services/accounts'

export default class ErrorHandlerMiddleware implements Middleware {
  private accounts: Accounts

  constructor (opts: {}, deps: reduct.Injector) {
    this.accounts = deps(Accounts)
  }

  async applyToPipelines (pipelines: Pipelines, account: Account) {
    const log = createLogger(`error-handler-middleware[${account.id}]`)

    /**
     * Important middleware. It ensures any errors thrown through the middleware pipe is converted to correct ILP
     * reject that is sent back to sender.
     */
    pipelines.incomingData.insertLast({
      name: 'errorHandler',
      method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {
        try {
          return await next(packet)
        } catch (e) {
          let err = e
          if (!err || typeof err !== 'object') {
            err = new Error('Non-object thrown: ' + e)
          }

          log.debug('error in data handler, creating rejection. ilpErrorCode=%s error=%s', err.ilpErrorCode, err.stack ? err.stack : err)

          return errorToIlpReject(this.accounts.getOwnAddress(), err)
        }
      }
    })
  }
}
