import * as IlpPacket from 'ilp-packet'
import {
  Middleware,
  MiddlewareCallback,
  MiddlewareServices,
  Pipelines
} from '../types/middleware'
import Stats from '../services/stats'
import { AccountInfo } from '../types/accounts'

export default class StatsMiddleware implements Middleware {
  private stats: Stats

  private getInfo: (accountId: string) => AccountInfo

  constructor (opts: {}, { stats, getInfo }: MiddlewareServices) {
    this.stats = stats
    this.getInfo = getInfo
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    const accountInfo = this.getInfo(accountId)
    if (!accountInfo) {
      throw new Error('could not load info for account. accountId=' + accountId)
    }
    const account = { accountId, accountInfo }
    pipelines.incomingData.insertLast({
      name: 'stats',
      method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
        try {
          const result = await next(data)
          if (result[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
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

    pipelines.incomingMoney.insertLast({
      name: 'stats',
      method: async (amount: string, next: MiddlewareCallback<string, void>) => {
        try {
          const result = await next(amount)
          this.stats.incomingMoney.setValue(account, { result: 'succeeded' }, +amount)
          return result
        } catch (err) {
          this.stats.incomingMoney.setValue(account, { result: 'failed' }, +amount)
          throw err
        }
      }
    })

    pipelines.outgoingData.insertLast({
      name: 'stats',
      method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
        try {
          const result = await next(data)
          if (result[0] === IlpPacket.Type.TYPE_ILP_FULFILL) {
            this.stats.outgoingDataPackets.increment(account, { result: 'fulfilled' })
          } else {
            const rejectPacket = IlpPacket.deserializeIlpReject(result)
            const { code } = rejectPacket
            this.stats.outgoingDataPackets.increment(account,
              { result: 'rejected', code })
          }
          return result
        } catch (err) {
          this.stats.outgoingDataPackets.increment(account, { result: 'failed' })
          throw err
        }
      }
    })

    pipelines.outgoingMoney.insertLast({
      name: 'stats',
      method: async (amount: string, next: MiddlewareCallback<string, void>) => {
        try {
          const result = await next(amount)
          this.stats.outgoingMoney.setValue(account, { result: 'succeeded' }, +amount)
          return result
        } catch (err) {
          this.stats.outgoingMoney.setValue(account, { result: 'failed' }, +amount)
          throw err
        }
      }
    })
  }
}
