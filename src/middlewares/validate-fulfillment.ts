import { createHash } from 'crypto'
import { create as createLogger } from '../common/log'
const log = createLogger('validate-fulfillment-middleware')
import { IlpPrepare, Errors as IlpPacketErrors, IlpReply, isFulfill } from 'ilp-packet'
import { Middleware, MiddlewareCallback, Pipelines } from '../types/middleware'
const { WrongConditionError } = IlpPacketErrors

export default class ValidateFulfillmentMiddleware implements Middleware {
  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    pipelines.outgoingData.insertLast({
      name: 'validateFulfillment',
      method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {
        const { executionCondition } = packet
        const result = await next(packet)

        if (isFulfill(result)) {
          const { fulfillment } = result
          const calculatedCondition = createHash('sha256').update(fulfillment).digest()
          if (!calculatedCondition.equals(executionCondition)) {
            log.error('received incorrect fulfillment from account. accountId=%s fulfillment=%s calculatedCondition=%s executionCondition=%s', accountId, fulfillment.toString('base64'), calculatedCondition.toString('base64'), executionCondition.toString('base64'))
            throw new WrongConditionError('fulfillment did not match expected value.')
          }
        }

        return result
      }
    })
  }
}
