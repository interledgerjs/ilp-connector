import { create as createLogger } from '../common/log'
const log = createLogger('throughput-middleware')
import { Middleware, MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'
import { AccountInfo } from '../types/accounts'
import TokenBucket from '../lib/token-bucket'
import * as IlpPacket from 'ilp-packet'
const { InsufficientLiquidityError } = IlpPacket.Errors

const DEFAULT_REFILL_PERIOD = 1000 // 1 second

export default class ThroughputMiddleware implements Middleware {
  private getInfo: (accountId: string) => AccountInfo

  constructor (opts: {}, { getInfo }: MiddlewareServices) {
    this.getInfo = getInfo
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    const accountInfo = this.getInfo(accountId)
    if (!accountInfo) {
      throw new Error('could not load info for account. accountId=' + accountId)
    }

    if (accountInfo.throughput) {
      const {
        refillPeriod = DEFAULT_REFILL_PERIOD,
        incomingAmount = false,
        outgoingAmount = false
      } = accountInfo.throughput || {}

      if (incomingAmount) {
        // TODO: When we add the ability to update middleware, our state will get
        //   reset every update, which may not be desired.
        const incomingBucket = new TokenBucket({ refillPeriod, refillCount: Number(incomingAmount) })
        log.debug('created incoming amount limit token bucket for account. accountId=%s refillPeriod=%s incomingAmount=%s', accountId, refillPeriod, incomingAmount)

        pipelines.incomingData.insertLast({
          name: 'throughput',
          method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
            if (data[0] === IlpPacket.Type.TYPE_ILP_PREPARE) {
              const parsedPacket = IlpPacket.deserializeIlpPrepare(data)

              // TODO: Do we need a BigNumber-based token bucket?
              if (!incomingBucket.take(Number(parsedPacket.amount))) {
                throw new InsufficientLiquidityError('exceeded money bandwidth, throttling.')
              }

              return next(data)
            } else {
              return next(data)
            }
          }
        })
      }

      if (outgoingAmount) {
        // TODO: When we add the ability to update middleware, our state will get
        //   reset every update, which may not be desired.
        const incomingBucket = new TokenBucket({ refillPeriod, refillCount: Number(outgoingAmount) })
        log.debug('created outgoing amount limit token bucket for account. accountId=%s refillPeriod=%s outgoingAmount=%s', accountId, refillPeriod, outgoingAmount)

        pipelines.outgoingData.insertLast({
          name: 'throughput',
          method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
            if (data[0] === IlpPacket.Type.TYPE_ILP_PREPARE) {
              const parsedPacket = IlpPacket.deserializeIlpPrepare(data)

              // TODO: Do we need a BigNumber-based token bucket?
              if (!incomingBucket.take(Number(parsedPacket.amount))) {
                throw new InsufficientLiquidityError('exceeded money bandwidth, throttling.')
              }

              return next(data)
            } else {
              return next(data)
            }
          }
        })
      }
    }
  }
}
