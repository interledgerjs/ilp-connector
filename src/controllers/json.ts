'use strict'

import { create as createLogger } from '../common/log'
const log = createLogger('json-controller')

import CcpController from './ccp'
import reduct = require('reduct')

export default class JsonController {
  protected ccpController: CcpController

  constructor (deps: reduct.Injector) {
    this.ccpController = deps(CcpController)
  }

  async handle (sourceAccount: string, payload: object) {
    if (!payload || typeof payload !== 'object') {
      log.warn('received non-object JSON payload, ignoring. payload=%j', payload)
      return {}
    }

    if (payload['method'] === 'broadcast_routes') {
      return this.ccpController.handle(sourceAccount, payload['data'])
    }

    log.warn('ignoring unkown request method', payload['method'])
    return {}
  }
}
