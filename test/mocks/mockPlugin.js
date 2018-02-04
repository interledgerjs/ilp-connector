'use strict'

const { EventEmitter } = require('events')

class MockPlugin extends EventEmitter {
  constructor (options) {
    super()

    this._dataHandler = null
    this._moneyHandler = null
  }

  connect () {
    this.connected = true
    this.emit('connect')
    return Promise.resolve(undefined)
  }

  disconnect () {
    this.connected = false
    return Promise.resolve(undefined)
  }

  isConnected () {
    return this.connected
  }

  sendData (data) {
    return Promise.reject(new Error('MockPlugin.sendData is not implemented: ' + this._account))
  }

  sendMoney (amount) {
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
