import { create as createLogger } from '../common/log'
import Middleware, { MiddlewareCallback, Pipelines } from '../types/middleware'
import { IlpPrepare, Errors, IlpReply } from 'ilp-packet'
import Account from '../types/account'
const { TransferTimedOutError } = Errors
const log = createLogger('expire-middleware')

export default class ExpireMiddleware implements Middleware {
  async applyToPipelines (pipelines: Pipelines, account: Account) {
    pipelines.outgoingData.insertLast({
      name: 'expire',
      method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {
        const { executionCondition, expiresAt } = packet
        const duration = expiresAt.getTime() - Date.now()
        const promise = next(packet)
        let timeout: NodeJS.Timer
        const timeoutPromise: Promise<IlpReply> = new Promise((resolve, reject) => {
          timeout = setTimeout(() => {
            log.debug('packet expired. cond=%s expiresAt=%s', executionCondition.slice(0, 6).toString('base64'), expiresAt.toISOString())
            reject(new TransferTimedOutError('packet expired.'))
          }, duration)
        })

        return Promise.race([
          promise.then((reply) => { clearTimeout(timeout); return reply }),
          timeoutPromise
        ])
      }
    })
  }
}
