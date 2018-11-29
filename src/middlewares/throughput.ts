import Middleware, { MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'
import TokenBucket from '../lib/token-bucket'
import { IlpPrepare, IlpReply, Errors } from 'ilp-packet'
import createLogger from 'ilp-logger'
import Account, { AccountInfo } from '../types/account'
const log = createLogger('throughput-middleware')
const { InsufficientLiquidityError } = Errors
const DEFAULT_REFILL_PERIOD = 1000 // 1 second

export default class ThroughputMiddleware implements Middleware {

  async applyToPipelines (pipelines: Pipelines, account: Account) {
    if (account.info.throughput) {
      const {
        refillPeriod = DEFAULT_REFILL_PERIOD,
        incomingAmount = false,
        outgoingAmount = false
      } = account.info.throughput || {}

      if (incomingAmount) {
        // TODO: When we add the ability to update middleware, our state will get
        //   reset every update, which may not be desired.
        const incomingBucket = new TokenBucket({ refillPeriod, refillCount: Number(incomingAmount) })
        log.trace('created incoming amount limit token bucket for account. accountId=%s refillPeriod=%s incomingAmount=%s',
          account.id, refillPeriod, incomingAmount)

        pipelines.incomingData.insertLast({
          name: 'throughput',
          method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {
            const { amount } = packet

            // TODO: Do we need a BigNumber-based token bucket?
            if (!incomingBucket.take(Number(amount))) {
              throw new InsufficientLiquidityError('exceeded money bandwidth, throttling.')
            }

            return next(packet)
          }
        })
      }

      if (outgoingAmount) {
        // TODO: When we add the ability to update middleware, our state will get
        //   reset every update, which may not be desired.
        const incomingBucket = new TokenBucket({ refillPeriod, refillCount: Number(outgoingAmount) })
        log.trace('created outgoing amount limit token bucket for account. accountId=%s refillPeriod=%s outgoingAmount=%s',
          account.id, refillPeriod, outgoingAmount)

        pipelines.outgoingData.insertLast({
          name: 'throughput',
          method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {
            const { amount } = packet

            // TODO: Do we need a BigNumber-based token bucket?
            if (!incomingBucket.take(Number(amount))) {
              throw new InsufficientLiquidityError('exceeded money bandwidth, throttling.')
            }

            return next(packet)
          }
        })
      }
    }
  }
}
