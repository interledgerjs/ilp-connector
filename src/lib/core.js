'use strict'

const _ = require('lodash')
const newSqliteStore = require('../lib/sqliteStore.js')
const ilpCore = require('ilp-core')

module.exports = function (options) {
  const config = options.config
  const makeLogger = options.log.create
  const routingTables = options.routingTables

  const core = new ilpCore.Core({routingTables})
  Object.keys(options.config.ledgerCredentials).forEach((ledgerPrefix) => {
    const creds = _.clone(options.config.ledgerCredentials[ledgerPrefix])
    const store = creds.store && newSqliteStore(creds.store)

    core.addClient(ledgerPrefix, new ilpCore.Client({
      plugin: require('ilp-plugin-' + creds.type),
      prefix: ledgerPrefix,
      host: creds.host,
      auth: creds,
      store: store,
      log: makeLogger('plugin-' + creds.type),
      connector: config.server.base_uri,
      debugReplyNotifications: config.features.debugReplyNotifications
    }))
  })
  return core
}
