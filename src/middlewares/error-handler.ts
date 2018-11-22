import { create as createLogger } from '../common/log'
import { IlpPrepare } from 'ilp-packet'
import { IlpReply, errorToIlpReject } from '../types/packet'
import { Middleware, MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'

export default class ErrorHandlerMiddleware implements Middleware {
  private getOwnAddress: () => string

  constructor (opts: {}, api: MiddlewareServices) {
    this.getOwnAddress = api.getOwnAddress
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    const log = createLogger(`error-handler-middleware[${accountId}]`)

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

          return errorToIlpReject(this.getOwnAddress(), err)
        }
      }
    })
  }
}
