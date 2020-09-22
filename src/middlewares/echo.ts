import { Middleware, MiddlewareServices, Pipelines, MiddlewareCallback } from '../types/middleware'
import { deserializeIlpPrepare, Type as IlpPacketType, Errors, serializeIlpPrepare } from 'ilp-packet'
import { Reader, Writer } from 'oer-utils'
const { InvalidPacketError } = Errors
import { create as createLogger } from '../common/log'
const log = createLogger('echo')

const MINIMUM_ECHO_PACKET_DATA_LENGTH = 16 + 1
const ECHO_DATA_PREFIX = Buffer.from('ECHOECHOECHOECHO', 'ascii')

export default class EchoMiddleware implements Middleware {
  private getOwnAddress: () => string

  constructor (opts: {}, { getOwnAddress }: MiddlewareServices) {
    this.getOwnAddress = getOwnAddress
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    pipelines.incomingData.insertLast({
      name: 'echo',
      method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
        if (data[0] === IlpPacketType.TYPE_ILP_PREPARE) {
          const parsedPacket = deserializeIlpPrepare(data)

          // Only echo packets sent directly to this connector
          if (parsedPacket.destination !== this.getOwnAddress()) {
            return next(data)
          }

          if (parsedPacket.data.length < MINIMUM_ECHO_PACKET_DATA_LENGTH) {
            throw new InvalidPacketError('packet data too short for echo request. length=' + parsedPacket.data.length)
          }

          if (!parsedPacket.data.slice(0, 16).equals(ECHO_DATA_PREFIX)) {
            throw new InvalidPacketError('packet data does not start with ECHO prefix.')
          }

          const reader = new Reader(parsedPacket.data)
          reader.skip(ECHO_DATA_PREFIX.length)
          const echoType = reader.readUInt8Number()

          if (echoType === 0) {
            const sourceAddress = reader.readVarOctetString().toString('ascii')

            log.trace(
              'responding to ping. sourceAccount=%s sourceAddress=%s cond=%s',
              accountId,
              sourceAddress,
              parsedPacket.executionCondition.slice(0, 9).toString('base64')
            )

            const writer = new Writer()
            writer.write(ECHO_DATA_PREFIX)
            writer.writeUInt8(1) // type = response

            return next(serializeIlpPrepare({
              amount: parsedPacket.amount,
              destination: sourceAddress,
              executionCondition: parsedPacket.executionCondition,
              expiresAt: parsedPacket.expiresAt,
              data: writer.getBuffer()
            }))
          } else {
            log.error('received unexpected ping response. sourceAccount=%s', accountId)
            throw new InvalidPacketError('unexpected ping response.')
          }
        } else {
          return next(data)
        }
      }
    })
  }
}
