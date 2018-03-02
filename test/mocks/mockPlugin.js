'use strict'

const { EventEmitter } = require('events')

class MockPlugin extends EventEmitter {
  constructor (options, { log }) {
    super()

    this._dataHandler = null
    this._moneyHandler = null
    this._log = log
  }

  connect () {
    this._log.debug('connecting.')
    this.connected = true
    this.emit('connect')
    return Promise.resolve(undefined)
  }

  disconnect () {
    this._log.debug('disconnecting.')
    this.connected = false
    return Promise.resolve(undefined)
  }

  isConnected () {
    return this.connected
  }

  sendData (data) {
    this._log.debug('sending data.')
    return Promise.reject(new Error('MockPlugin.sendData is not implemented: ' + this._account))
  }

  sendMoney (amount) {
    this._log.debug('sending money. amount=%s', amount)
    return Promise.reject(new Error('MockPlugin.sendMoney is not implemented: ' + this._account))
  }

  registerDataHandler (dataHandler) {
    this._dataHandler = dataHandler
  }

  registerMoneyHandler (moneyHandler) {
    this._moneyHandler = moneyHandler
  }

  deregisterDataHandler (dataHandler) {
    this._dataHandler = null
  }

  deregisterMoneyHandler (moneyHandler) {
    this._moneyHandler = null
  }
}

MockPlugin.version = 2

module.exports = MockPlugin
