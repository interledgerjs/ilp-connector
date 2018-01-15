import { createHash } from 'crypto'
import { create as createLogger } from '../common/log'
const log = createLogger('validate-fulfillment-middleware')
import * as IlpPacket from 'ilp-packet'
import { Middleware, MiddlewareCallback, Pipelines } from '../types/middleware'
import InvalidFulfillmentError from '../errors/invalid-fulfillment-error'

export default class ValidateFulfillmentMiddleware implements Middleware {
  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    pipelines.outgoingData.insertLast({
      name: 'validateFulfillment',
      method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
        if (data[0] === IlpPacket.Type.TYPE_ILP_PREPARE) {
          const { executionCondition } = IlpPacket.deserializeIlpPrepare(data)

          const result = await next(data)

          if (result[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
            const { fulfillment } = IlpPacket.deserializeIlpFulfill(result)
            const calculatedCondition = createHash('sha256').update(fulfillment).digest()

            if (!calculatedCondition.equals(executionCondition)) {
              log.warn('received incorrect fulfillment from account. accountId=%s fulfillment=%s calculatedCondition=%s executionCondition=%s', accountId, fulfillment.toString('base64'), calculatedCondition.toString('base64'), executionCondition.toString('base64'))
              throw new InvalidFulfillmentError('fulfillment did not match expected value.')
            }
          }

          return result
        }

        return next(data)
      }
    })
  }
}
