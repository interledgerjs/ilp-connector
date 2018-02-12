import { create as createLogger } from '../common/log'
const log = createLogger('echo')
import reduct = require('reduct')
import { serializeIlpPrepare, IlpPrepare } from 'ilp-packet'
import { Reader, Writer } from 'oer-utils'
import Config from '../services/config'
import RouteBuilder from '../services/route-builder'
import InvalidPacketError from '../errors/invalid-packet-error'

const MINIMUM_ECHO_PACKET_DATA_LENGTH = 16 + 1
const ECHO_DATA_PREFIX = Buffer.from('ECHOECHOECHOECHO', 'ascii')

export default class EchoController {
  private config: Config
  private routeBuilder: RouteBuilder

  constructor (deps: reduct.Injector) {
    this.config = deps(Config)
    this.routeBuilder = deps(RouteBuilder)
  }

  async handle (
    data: Buffer,
    sourceAccount: string,
    { parsedPacket, outbound }: {
      parsedPacket: IlpPrepare,
      outbound: (data: Buffer, accountId: string) => Promise<Buffer>
    }
  ) {
    if (parsedPacket.data.length < MINIMUM_ECHO_PACKET_DATA_LENGTH) {
      throw new InvalidPacketError('packet data too short for echo request. length=' + parsedPacket.data.length)
    }

    if (!parsedPacket.data.slice(0, 16).equals(ECHO_DATA_PREFIX)) {
      throw new InvalidPacketError('packet data does not start with ECHO prefix.')
    }

    const reader = new Reader(parsedPacket.data)

    reader.skip(ECHO_DATA_PREFIX.length)

    const type = reader.readUInt8()

    if (type === 0) {
      const sourceAddress = reader.readVarOctetString().toString('ascii')

      log.debug('responding to ping. sourceAccount=%s sourceAddress=%s cond=%s', sourceAccount, sourceAddress, parsedPacket.executionCondition.slice(0, 9).toString('base64'))

      const nextHop = this.routeBuilder.getNextHop(sourceAccount, sourceAddress)

      const writer = new Writer()

      writer.write(ECHO_DATA_PREFIX)

      writer.writeUInt8(0x01) // type = response

      return outbound(serializeIlpPrepare({
        amount: parsedPacket.amount,
        destination: sourceAddress,
        executionCondition: parsedPacket.executionCondition,
        expiresAt: new Date(Number(parsedPacket.expiresAt) - this.config.minMessageWindow),
        data: writer.getBuffer()
      }), nextHop)
    } else {
      log.debug('received unexpected ping response. sourceAccount=%s', sourceAccount)
      throw new InvalidPacketError('unexpected ping response.')
    }
  }
}
