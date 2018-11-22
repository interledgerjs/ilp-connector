const log_1 = require('../src/common/log')
const log = log_1.create('accountManager')

function main () {
  const IlpConnector = require('../')
  this.connector = IlpConnector.createApp({
    ilpAddress: 'test.quickstart',
    "account-manager": 'btp-grpc',
    // "account-manager": 'in-process',
    accounts: {
      "USER000001": {
        "plugin": "ilp-plugin-btp",
        "relation": "peer",
        "assetCode": "USD",
        "assetScale": 9,
        "sendRoutes": false,
        "receiveRoutes": false,
        "options": {
          "listener": {
            "port": 7001,
            "secret": "6cbe513aaf323a4c7a94639a9bd6ffbc"
          }
        }
      }
    },
    backend: 'one-to-one',
    spread: 0,
    storePath: './data',
    adminApi: true,
    adminApiPort: 7769,
    adminApiHost: 'localhost'
  })
  let shuttingDown = false
  process.on('SIGINT', async () => {
    try {
      if (shuttingDown) {
        log.warn('received second SIGINT during graceful shutdown, exiting forcefully.')
        process.exit(1)
      }
      shuttingDown = true
      log.debug('shutting down.')
      await this.connector.shutdown()
      log.debug('completed graceful shutdown.')
      process.exit(0)
    } catch (err) {
      const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
      console.error('error while shutting down. error=%s', errInfo)
      process.exit(1)
    }
  })

  this.connector.listen()
    .catch((err) => {
      const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
      log.error(errInfo)
    }).then(() => {
      return this.connector
    })
}

main()
