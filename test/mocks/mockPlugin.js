'use strict'

const EventEmitter = require('eventemitter2')

class MockPlugin extends EventEmitter {
  constructor () {
    super()
    this.id = 'mock:'
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

  send () {
    return Promise.resolve(null)
  }

  fulfillCondition () {
    return Promise.resolve(null)
  }

  getAccount () {
    return 'mocky'
  }
}

module.exports = MockPlugin
