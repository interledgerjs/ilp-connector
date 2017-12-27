'use strict'

const log = require('../common/log').create('json-controller')

const CcpController = require('./ccp')

class JsonController {
  constructor (deps) {
    this.ccpController = deps(CcpController)
  }

  async handle (sourceAccount, payload) {
    if (!payload || typeof payload !== 'object') {
      log.warn('received non-object JSON payload, ignoring. payload=%j', payload)
      return {}
    }

    if (payload.method === 'broadcast_routes') {
      return this.ccpController.handle(sourceAccount, payload.data)
    }

    log.warn('ignoring unkown request method', payload.method)
    return {}
  }
}

module.exports = JsonController
