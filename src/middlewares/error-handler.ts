import { create as createLogger } from '../common/log'
import { Middleware, MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'
import * as IlpPacket from 'ilp-packet'

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
      method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
        try {
          const response = await next(data)

          if (!Buffer.isBuffer(response)) {
            throw new Error('handler did not return a value.')
          }

          return response
        } catch (e) {
          let err = e
          if (!err || typeof err !== 'object') {
            err = new Error('Non-object thrown: ' + e)
          }

          log.debug('error in data handler, creating rejection. ilpErrorCode=%s error=%s', err.ilpErrorCode, err.stack ? err.stack : err)

          return IlpPacket.errorToReject(this.getOwnAddress(), err)
        }
      }
    })

    pipelines.incomingMoney.insertLast({
      name: 'errorHandler',
      method: async (amount: string, next: MiddlewareCallback<string, void>) => {
        try {
          return await next(amount)
        } catch (e) {
          let err = e
          if (!err || typeof err !== 'object') {
            err = new Error('non-object thrown. value=' + e)
          }

          log.debug('error in money handler. error=%s', err.stack ? err.stack : err)

          throw err
        }
      }
    })
  }
}
