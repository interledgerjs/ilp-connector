import {
  Middleware,
  MiddlewareCallback,
  MiddlewareServices,
  Pipelines
} from '../types/middleware'
import BigNumber from 'bignumber.js'
import { IlpPrepare, IlpReply, isFulfill } from 'ilp-packet'
import Stats from '../services/stats'
import { AccountInfo } from 'ilp-account-service'

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
      method: async (packet: IlpPrepare, next: MiddlewareCallback<IlpPrepare, IlpReply>) => {
        try {
          const result = await next(packet)
          if (isFulfill(result)) {
            this.stats.incomingDataPackets.increment(account, { result: 'fulfilled' })
            this.stats.incomingDataPacketValue.increment(account, { result: 'fulfilled' }, new BigNumber(packet.amount).toNumber())
          } else {
            this.stats.incomingDataPackets.increment(account, { result: 'rejected' })
            this.stats.incomingDataPacketValue.increment(account, { result: 'fulfilled' }, new BigNumber(packet.amount).toNumber())
          }
          return result
        } catch (err) {
          this.stats.incomingDataPackets.increment(account, { result: 'failed' })
          this.stats.incomingDataPacketValue.increment(account, { result: 'failed' }, new BigNumber(packet.amount).toNumber())
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
            this.stats.outgoingDataPacketValue.increment(account, { result: 'fulfilled' }, new BigNumber(packet.amount).toNumber())
          } else {
            const { code } = result
            this.stats.outgoingDataPackets.increment(account, { result: 'rejected', code })
            this.stats.outgoingDataPacketValue.increment(account, { result: 'rejected', code }, new BigNumber(packet.amount).toNumber())
          }
          return result
        } catch (err) {
          this.stats.outgoingDataPackets.increment(account, { result: 'failed' })
          this.stats.outgoingDataPacketValue.increment(account, { result: 'failed' }, new BigNumber(packet.amount).toNumber())
          throw err
        }
      }
    })
  }
}
