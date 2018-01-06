#!/usr/bin/env node

require('source-map-support').install()

import createApp from './app'
import { create as createLogger } from './common/log'
const log = createLogger('app')

module.exports = {
  createApp: createApp
}

if (!module.parent) {
  const connector = createApp()
  connector.listen()
    .catch((err: any) => {
      const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
      log.error(errInfo)
    })
}
