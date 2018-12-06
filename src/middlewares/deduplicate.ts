import { create as createLogger } from '../common/log'
import { createHash } from 'crypto'
import * as IlpPacket from 'ilp-packet'
import { Middleware, MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'
import { AccountInfo } from '../types/accounts'
import BigNumber from 'bignumber.js'

// Where in the ILP packet does the static data begin (i.e. the data that is not modified hop-to-hop)
const STATIC_DATA_OFFSET = 25 // 8 byte amount + 17 byte expiry date

const DEFAULT_CLEANUP_INTERVAL = 30000
const DEFAULT_PACKET_LIFETIME = 30000

interface CachedPacket {
  amount: string,
  expiresAt: Date,
  promise: Promise<Buffer>
}

export default class DeduplicateMiddleware implements Middleware {
  private packetCache: Map<string, CachedPacket> = new Map()
  private getInfo: (accountId: string) => AccountInfo

  constructor (opts: {}, { getInfo }: MiddlewareServices) {
    this.getInfo = getInfo
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    const log = createLogger(`deduplicate-middleware[${accountId}]`)
    const accountInfo = this.getInfo(accountId)
    if (!accountInfo) {
      throw new Error('account info unavailable. accountId=' + accountId)
    }

    const {
      cleanupInterval,
      packetLifetime
    } = accountInfo.deduplicate || {
      cleanupInterval: DEFAULT_CLEANUP_INTERVAL,
      packetLifetime: DEFAULT_PACKET_LIFETIME
    }

    let interval
    pipelines.startup.insertLast({
      name: 'deduplicate',
      method: async (dummy: void, next: MiddlewareCallback<void, void>) => {
        interval = setInterval(() => this.cleanupCache(packetLifetime), cleanupInterval)
        return next(dummy)
      }
    })

    pipelines.teardown.insertLast({
      name: 'deduplicate',
      method: async (dummy: void, next: MiddlewareCallback<void, void>) => {
        clearInterval(interval)
        return next(dummy)
      }
    })

    pipelines.outgoingData.insertLast({
      name: 'deduplicate',
      method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
        if (data[0] === IlpPacket.Type.TYPE_ILP_PREPARE) {
          const { contents } = IlpPacket.deserializeEnvelope(data)

          const index = createHash('sha256')
            .update(contents.slice(STATIC_DATA_OFFSET))
            .digest()
            .slice(0, 16) // 128 bits is enough and saves some memory
            .toString('base64')

          const { amount, expiresAt } = IlpPacket.deserializeIlpPrepare(data)

          const cachedPacket = this.packetCache.get(index)
          if (cachedPacket) {
            // We have seen this packet before, let's check if previous amount and expiresAt were larger
            if (new BigNumber(cachedPacket.amount).gte(amount) && cachedPacket.expiresAt >= expiresAt) {
              log.warn('deduplicate packet cache hit. accountId=%s elapsed=%s amount=%s', accountId, cachedPacket.expiresAt.getTime() - Date.now(), amount)
              return cachedPacket.promise
            }
          }

          const promise = next(data)

          this.packetCache.set(index, {
            amount,
            expiresAt,
            promise
          })

          return promise
        }

        return next(data)
      }
    })
  }

  private cleanupCache (packetLifetime: number) {
    const now = Date.now()
    for (const index of this.packetCache.keys()) {
      const cachedPacket = this.packetCache.get(index)
      if (!cachedPacket) continue
      const packetExpiry = cachedPacket.expiresAt.getTime() + packetLifetime
      if (packetExpiry < now) {
        this.packetCache.delete(index)
      }
    }
  }
}
