'use strict'

const EventEmitter = require('eventemitter2')

class MockPlugin extends EventEmitter {
  constructor (options) {
    super()
    this.id = options.id || 'mock:'
  }

  connect () {
    this.connected = true
    this.emit('connect')
    return Promise.resolve(null)
  }

  disconnect () {
    this.connected = false
  }

  isConnected () {
    return this.connected
  }

  getConnectors () {
    return Promise.resolve(['http://connector.example'])
  }

  send (transfer) {
    return Promise.resolve(null)
  }

  fulfillCondition (transferId, conditionFulfillment) {
    return Promise.resolve(null)
  }

  getAccount () {
    return 'mocky'
  }

  * _handleNotification () { }

  * getBalance () {
    return '123.456'
  }

  * getInfo () {
    return {precision: 10, scale: 4}
  }
}

module.exports = MockPlugin
