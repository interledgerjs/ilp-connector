'use strict'

const _ = require('lodash')
const newSqliteStore = require('../lib/sqliteStore.js')
const ilpCore = require('ilp-core')

module.exports = function (options) {
  const config = options.config
  const makeLogger = options.log.create
  const routingTables = options.routingTables

  const core = new ilpCore.Core({routingTables})
  Object.keys(config.ledgerCredentials).forEach((ledgerPrefix) => {
    const creds = _.clone(config.ledgerCredentials[ledgerPrefix])
    const store = creds.store && newSqliteStore(creds.store)

    creds.prefix = ledgerPrefix
    core.addClient(ledgerPrefix, new ilpCore.Client(Object.assign({}, creds, {
      debugReplyNotifications: config.features.debugReplyNotifications,
      connector: config.server.base_uri,
      // non JSON-stringifiable fields are prefixed with an underscore
      _plugin: require('ilp-plugin-' + creds.type),
      _store: store,
      _log: makeLogger('plugin-' + creds.type)
    })))
  })
  return core
}
