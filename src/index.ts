#!/usr/bin/env node

require('source-map-support').install()

import createApp from './app'
import { create as createLogger } from './common/log'

const log = createLogger('app')

export { createApp }

if (!module.parent) {
  const connector = createApp()
  connector.listen()
    .catch((err: any) => {
      const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
      log.error(errInfo)
    })

  let shuttingDown = false
  process.on('SIGINT', async () => {
    try {
      if (shuttingDown) {
        log.warn('received second SIGINT during graceful shutdown, exiting forcefully.')
        process.exit(1)
        return
      }

      shuttingDown = true

      // Graceful shutdown
      log.debug('shutting down.')
      await connector.shutdown()
      log.debug('completed graceful shutdown.')
      process.exit(0)
    } catch (err) {
      const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
      log.error('error while shutting down. error=%s', errInfo)
      process.exit(1)
    }
  })
}
