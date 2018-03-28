import * as IlpPacket from 'ilp-packet'
import {
  Middleware,
  MiddlewareCallback,
  MiddlewareMethod,
  MiddlewareServices,
  MiddlewareStats,
  Pipelines
} from '../types/middleware'

export default class StatsMiddleware implements Middleware {
  private stats: MiddlewareStats

  constructor (opts: {}, { stats }: MiddlewareServices) {
    this.stats = stats
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    pipelines.incomingData.insertLast({
      name: 'stats',
      method: this.makeDataMiddleware('stats/incomingData/' + accountId)
    })

    pipelines.incomingMoney.insertLast({
      name: 'stats',
      method: async (amount: string, next: MiddlewareCallback<string, void>) => {
        this.stats.counter('stats/incomingMoney/' + accountId, +amount)
        return next(amount)
      }
    })

    pipelines.outgoingData.insertLast({
      name: 'stats',
      method: this.makeDataMiddleware('stats/outgoingData/' + accountId)
    })

    pipelines.outgoingMoney.insertLast({
      name: 'stats',
      method: async (amount: string, next: MiddlewareCallback<string, void>) => {
        this.stats.counter('stats/outgoingMoney/' + accountId, +amount)
        return next(amount)
      }
    })
  }

  private makeDataMiddleware (prefix: string): MiddlewareMethod<Buffer,Buffer> {
    return async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
      if (data[0] !== IlpPacket.Type.TYPE_ILP_PREPARE) return next(data)
      const { amount } = IlpPacket.deserializeIlpPrepare(data)
      if (amount === '0') return next(data)
      let result
      try {
        result = await next(data)
      } catch (err) {
        this.stats.counter(prefix + '/failed', +amount)
        throw err
      }
      if (result[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
        this.stats.counter(prefix + '/fulfilled', +amount)
      } else {
        this.stats.counter(prefix + '/rejected', +amount)
      }
      return result
    }
  }
}
