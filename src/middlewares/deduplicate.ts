import { createHash } from 'crypto'
import * as IlpPacket from 'ilp-packet'
import { Middleware, MiddlewareCallback, Pipelines } from '../types/middleware'
import BigNumber from 'bignumber.js'

// Where in the ILP packet does the static data begin (i.e. the data that is not modified hop-to-hop)
const STATIC_DATA_OFFSET = 25 // 8 byte amount + 17 byte expiry date

const CACHE_CLEANUP_INTERVAL = 30000
const PACKET_CACHE_DURATION = 30000

interface CachedPacket {
  amount: string,
  expiresAt: Date,
  promise: Promise<Buffer>
}

export default class DeduplicateMiddleware implements Middleware {
  private packetCache: Map<string, CachedPacket> = new Map()

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    pipelines.startup.insertLast({
      name: 'deduplicate',
      method: async (dummy: void, next: MiddlewareCallback<void, void>) => {
        setInterval(() => this.cleanupCache(), CACHE_CLEANUP_INTERVAL)
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

  private cleanupCache () {
    const now = Date.now()
    for (const index of this.packetCache.keys()) {
      const cachedPacket = this.packetCache.get(index)
      if (!cachedPacket) continue
      const packetExpiry = cachedPacket.expiresAt.getTime() + PACKET_CACHE_DURATION
      if (packetExpiry < now) {
        this.packetCache.delete(index)
      }
    }
  }
}
