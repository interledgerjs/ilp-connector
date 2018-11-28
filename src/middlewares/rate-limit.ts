import { IlpPrepare, IlpReply, Errors } from 'ilp-packet'
import createLogger from 'ilp-logger'
const log = createLogger('rate-limit-middleware')
import {
  Middleware,
  MiddlewareCallback,
  MiddlewareServices,
  Pipelines
} from '../types/middleware'
import TokenBucket from '../lib/token-bucket'
import Stats from '../services/stats'
import { AccountInfo } from '../../../ilp-account-service/build'
const { RateLimitedError } = Errors
const DEFAULT_REFILL_PERIOD = 60 * 1000 // 1 minute
const DEFAULT_REFILL_COUNT = 10000
const DEFAULT_CAPACITY = 10000

export default class RateLimitMiddleware implements Middleware {
  private getInfo: (accountId: string) => AccountInfo
  private stats: Stats

  constructor (opts: {}, { getInfo, stats }: MiddlewareServices) {
    this.getInfo = getInfo
    this.stats = stats
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    const accountInfo = this.getInfo(accountId)
    const account = { accountId, accountInfo }
    const {
      refillPeriod = DEFAULT_REFILL_PERIOD,
      refillCount = DEFAULT_REFILL_COUNT,
      capacity = DEFAULT_CAPACITY
    } = accountInfo.rateLimit || {}

    log.trace('created token bucket for account. accountId=%s refillPeriod=%s refillCount=%s capacity=%s',
      accountId, refillPeriod, refillCount, capacity)

    // TODO: When we add the ability to update middleware, our state will get
    //   reset every update, which may not be desired.
    const bucket = new TokenBucket({ refillPeriod, refillCount, capacity })

    pipelines.incomingData.insertLast({
      name: 'rateLimit',
      method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {
        if (!bucket.take()) {
          this.stats.rateLimitedPackets.increment(account, {})
          throw new RateLimitedError('too many requests, throttling.')
        }

        return next(packet)
      }
    })

    pipelines.incomingMoney.insertLast({
      name: 'rateLimit',
      method: (amount: string, next: MiddlewareCallback<string, void>) => {
        if (!bucket.take()) {
          this.stats.rateLimitedMoney.increment(account, {})
          throw new RateLimitedError('too many requests, throttling.')
        }

        return next(amount)
      }
    })
  }
}
