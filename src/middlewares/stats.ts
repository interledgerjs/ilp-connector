import * as reduct from 'reduct'
import Middleware, {
  MiddlewareCallback,
  MiddlewareServices,
  Pipelines
} from '../types/middleware'
import { IlpPrepare, IlpReply, isFulfill } from 'ilp-packet'
import Stats from '../services/stats'
import Account, { AccountInfo } from '../types/account'

export default class StatsMiddleware implements Middleware {
  private stats: Stats

  constructor (opts: {}, deps: reduct.Injector) {
    this.stats = deps(Stats)
  }

  async applyToPipelines (pipelines: Pipelines, account: Account) {
    pipelines.incomingData.insertLast({
      name: 'stats',
      method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {
        try {
          const result = await next(packet)
          if (isFulfill(result)) {
            this.stats.incomingDataPackets.increment(account, { result: 'fulfilled' })
          } else {
            this.stats.incomingDataPackets.increment(account, { result: 'rejected' })
          }
          return result
        } catch (err) {
          this.stats.incomingDataPackets.increment(account, { result: 'failed' })
          throw err
        }
      }
    })

    pipelines.outgoingData.insertLast({
      name: 'stats',
      method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {
        try {
          const result = await next(packet)
          if (isFulfill(result)) {
            this.stats.outgoingDataPackets.increment(account, { result: 'fulfilled' })
          } else {
            const { code } = result
            this.stats.outgoingDataPackets.increment(account, { result: 'rejected', code })
          }
          return result
        } catch (err) {
          this.stats.outgoingDataPackets.increment(account, { result: 'failed' })
          throw err
        }
      }
    })
  }
}
