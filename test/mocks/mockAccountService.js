'use strict'

class MockAccountService {
  constructor (accountId, accountInfo, log) {
    this._log = log
    this._connectHandler = undefined
    this._disconnectHandler = undefined
    this._packetHandler = undefined
  }

  registerConnectHandler (handler) {
    if (this.connectHandler) {
      this._log.error('Connect handler already exists')
      throw new Error('Connect handler already exists')
    }
    this._connectHandler = handler
  }

  deregisterConnectHandler () {
    if (this._connectHandler) {
      this._connectHandler = undefined
    }
  }

  registerDisconnectHandler (handler) {
    if (this.disconnectHandler) {
      this._log.error('Disconnect handler already exists')
      throw new Error('Disconnect handler already exists')
    }
    this.disconnectHandler = handler
  }

  deregisterDisconnectHandler () {
    if (this.disconnectHandler) {
      this.disconnectHandler = undefined
    }
  }

  async sendIlpPacket (packet) {
    this._log.debug('sending packet.')
    return Promise.reject(new Error('MockAccountService.sendIlpPacket is not implemented.'))
  }

  registerIlpPacketHandler (handler) {
    if (this._packetHandler) {
      this._log.error('Packet handler already exists')
      throw new Error('Packet handler already exists')
    }
    this._packetHandler = handler
  }

  deregisterIlpPacketHandler () {
    this._packetHandler = undefined
  }

  getInfo () {
    return {}
  }
}

module.exports = MockAccountService
