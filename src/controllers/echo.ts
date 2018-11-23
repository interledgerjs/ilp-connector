import { create as createLogger } from '../common/log'
const log = createLogger('echo')
import reduct = require('reduct')
import { serializeIlpPrepare, IlpPrepare, Errors } from 'ilp-packet'
import { Reader, Writer } from 'oer-utils'
import Config from '../services/config'
import RouteBuilder from '../services/route-builder'
import { IlpReply } from 'ilp-account-service'
const { InvalidPacketError } = Errors

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
    packet: IlpPrepare,
    sourceAccount: string,
    outbound: (packet: IlpPrepare, accountId: string) => Promise<IlpReply>
  ): Promise<IlpReply> {
    if (packet.data.length < MINIMUM_ECHO_PACKET_DATA_LENGTH) {
      throw new InvalidPacketError('packet data too short for echo request. length=' + packet.data.length)
    }

    if (!packet.data.slice(0, 16).equals(ECHO_DATA_PREFIX)) {
      throw new InvalidPacketError('packet data does not start with ECHO prefix.')
    }

    const reader = new Reader(packet.data)

    reader.skip(ECHO_DATA_PREFIX.length)

    const type = Number(reader.readUInt8())

    if (type === 0) {
      const sourceAddress = reader.readVarOctetString().toString('ascii')

      log.trace('responding to ping. sourceAccount=%s sourceAddress=%s cond=%s', sourceAccount, sourceAddress, packet.executionCondition.slice(0, 9).toString('base64'))

      const nextHop = this.routeBuilder.getNextHop(sourceAccount, sourceAddress)

      const writer = new Writer()

      writer.write(ECHO_DATA_PREFIX)

      writer.writeUInt8(0x01) // type = response

      return outbound({
        amount: packet.amount,
        destination: sourceAddress,
        executionCondition: packet.executionCondition,
        expiresAt: new Date(Number(packet.expiresAt) - this.config.minMessageWindow),
        data: writer.getBuffer()
      }, nextHop)
    } else {
      log.error('received unexpected ping response. sourceAccount=%s', sourceAccount)
      throw new InvalidPacketError('unexpected ping response.')
    }
  }
}
