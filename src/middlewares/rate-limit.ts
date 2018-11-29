import * as reduct from 'reduct'
import { IlpPrepare, IlpReply, Errors } from 'ilp-packet'
import Middleware, {
  MiddlewareCallback,
  MiddlewareServices,
  Pipelines
} from '../types/middleware'
import TokenBucket from '../lib/token-bucket'
import Stats from '../services/stats'
import Account, { AccountInfo } from '../types/account'
import createLogger from 'ilp-logger'
const log = createLogger('rate-limit-middleware')
const { RateLimitedError } = Errors

const DEFAULT_REFILL_PERIOD = 60 * 1000 // 1 minute
const DEFAULT_REFILL_COUNT = 10000
const DEFAULT_CAPACITY = 10000

export default class RateLimitMiddleware implements Middleware {
  private stats: Stats

  constructor (opts: {}, deps: reduct.Injector) {
    this.stats = deps(Stats)
  }

  async applyToPipelines (pipelines: Pipelines, account: Account) {
    const {
      refillPeriod = DEFAULT_REFILL_PERIOD,
      refillCount = DEFAULT_REFILL_COUNT,
      capacity = DEFAULT_CAPACITY
    } = account.info.rateLimit || {}

    log.trace('created token bucket for account. accountId=%s refillPeriod=%s refillCount=%s capacity=%s',
      account.id, refillPeriod, refillCount, capacity)

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
