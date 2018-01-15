import { create as createLogger } from '../common/log'
const log = createLogger('error-handler-middleware')
import { Middleware, MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'
import * as IlpPacket from 'ilp-packet'
import { codes } from '../lib/ilp-errors'

export default class ErrorHandlerMiddleware implements Middleware {
  private getOwnAddress: () => string

  constructor (opts: {}, api: MiddlewareServices) {
    this.getOwnAddress = api.getOwnAddress
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
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

          const code = err.ilpErrorCode || codes.F00_BAD_REQUEST

          log.debug('error in data handler, creating rejection. ilpErrorCode=%s error=%s', code, err.stack ? err.stack : err)

          return IlpPacket.serializeIlpReject({
            code,
            message: err.message ? err.message : String(err),
            triggeredBy: this.getOwnAddress(),
            data: Buffer.isBuffer(err.ilpErrorData) ? err.ilpErrorData : Buffer.alloc(0)
          })
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
            err = new Error('Non-object thrown: ' + e)
          }

          log.debug('error in money handler. error=%s', err.stack ? err.stack : err)

          throw err
        }
      }
    })
  }
}
