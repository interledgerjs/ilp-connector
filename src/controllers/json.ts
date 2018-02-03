import { create as createLogger } from '../common/log'
const log = createLogger('json-controller')

import CcpController from './ccp'
import InvalidPacketError from '../errors/invalid-packet-error'
import reduct = require('reduct')

export default class JsonController {
  protected ccpController: CcpController

  constructor (deps: reduct.Injector) {
    this.ccpController = deps(CcpController)
  }

  async sendData (packet: Buffer, sourceAccount: string) {
    const payload = JSON.parse(packet.toString('utf8'))

    if (!payload || typeof payload !== 'object') {
      log.warn('received non-object JSON payload, rejecting. payload=%j', payload)
      throw new InvalidPacketError('non-object json payload.')
    }

    if (payload['method'] === 'broadcast_routes') {
      const result = await this.ccpController.handle(payload['data'], sourceAccount)
      return Buffer.from(JSON.stringify(result), 'utf8')
    }

    log.warn('rejecting unknown request method. method=%s', payload['method'])
    throw new InvalidPacketError('unknown request method.')
  }
}
