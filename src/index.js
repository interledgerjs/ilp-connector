'use strict'
const createApp = require('./app')

const connector = createApp()

module.exports = {
  createApp: createApp,
  addPlugin: connector.addPlugin,
  removePlugin: connector.removePlugin,
  listen: connector.listen
}

if (!module.parent) {
  connector.listen()
}
