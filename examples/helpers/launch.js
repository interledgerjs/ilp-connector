'use strict'
const log_1 = require('../../src/common/log')
const log = log_1.create('launch')

function launch (pluginName) {
  const IlpConnector = require('../..')
  const connector = IlpConnector.createApp({
    ilpAddress: 'test.quickstart',
    accounts: {
      alice: {
        relation: 'child',
        assetScale: 6,
        assetCode: 'XRP',
        plugin: pluginName,
        options: {
          info: {
            prefix: 'test.quickstart.alice'
          },
          account: 'test.quickstart.alice.connector',
          balance: '0'
        }
      },
      bob: {
        relation: 'child',
        assetScale: 6,
        assetCode: 'XRP',
        plugin: pluginName,
        options: {
          info: {
            prefix: 'test.quickstart.bob'
          },
          account: 'test.quickstart.bob.connector',
          balance: '0'
        }
      }
    },
    backend: 'one-to-one',
    spread: 0,
    storePath: './data'
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
          log.debug('shutting down.')
          await connector.shutdown()
          log.debug('completed graceful shutdown.')
          process.exit(0)
      }
      catch (err) {
          const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
          console.error('error while shutting down. error=%s', errInfo)
          process.exit(1)
      }
  })
  return connector.listen()
      .catch((err) => {
      const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
      log.error(errInfo)
  }).then(() => {
    return connector
  })
}
module.exports = launch
