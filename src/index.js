'use strict'

require('source-map-support').install()

const createApp = require('./app')
const log = require('./common/log').create('app')

module.exports = {
  createApp: createApp
}

if (!module.parent) {
  const connector = createApp()
  connector.listen()
    .catch(err => {
      const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
      log.error(errInfo)
    })
}
