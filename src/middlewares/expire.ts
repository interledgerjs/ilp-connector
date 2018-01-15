import { create as createLogger } from '../common/log'
const log = createLogger('expire-middleware')
import * as IlpPacket from 'ilp-packet'
import { Middleware, MiddlewareCallback, Pipelines } from '../types/middleware'
import PacketExpiredError from '../errors/packet-expired-error'

export default class ExpireMiddleware implements Middleware {
  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    pipelines.outgoingData.insertLast({
      name: 'expire',
      method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
        if (data[0] === IlpPacket.Type.TYPE_ILP_PREPARE) {
          const { executionCondition, expiresAt } = IlpPacket.deserializeIlpPrepare(data)

          const duration = expiresAt.getTime() - Date.now()

          const promise = next(data)

          let timeout
          const timeoutPromise: Promise<Buffer> = new Promise((resolve, reject) => {
            timeout = setTimeout(() => {
              log.debug('packet expired. cond=%s expiresAt=%s', executionCondition.slice(0, 6).toString('base64'), expiresAt.toISOString())
              reject(new PacketExpiredError('packet expired.'))
            }, duration)
          })

          promise.then(() => clearTimeout(timeout))

          return Promise.race([promise, timeoutPromise])
        }

        return next(data)
      }
    })
  }
}
