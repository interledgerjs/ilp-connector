import { createHash } from 'crypto'
import * as IlpPacket from 'ilp-packet'
import { Middleware, MiddlewareCallback, Pipelines } from '../types/middleware'
import BigNumber from 'bignumber.js'

// Where in the ILP packet does the static data begin (i.e. the data that is not modified hop-to-hop)
const STATIC_DATA_OFFSET = 25 // 8 byte amount + 17 byte expiry date

interface CachedPacket {
  amount: string,
  expiresAt: Date,
  promise: Promise<Buffer>
}

export default class DeduplicateMiddleware implements Middleware {
  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    const packetCache: Map<string, CachedPacket> = new Map()

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

          const cachedPacket = packetCache.get(index)
          if (cachedPacket) {
            // We have seen this packet before, let's check if previous amount and expiresAt were larger
            if (new BigNumber(cachedPacket.amount).gte(amount) && cachedPacket.expiresAt >= expiresAt) {
              return cachedPacket.promise
            }
          }

          const promise = next(data)

          packetCache.set(index, {
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
}
