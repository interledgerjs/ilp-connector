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
    const creds = _.cloneDeep(config.ledgerCredentials[ledgerPrefix])
    const store = creds.options.store && newSqliteStore(creds.options.store)

    creds.options.prefix = ledgerPrefix
    core.addClient(ledgerPrefix, new ilpCore.Client(Object.assign({}, creds.options, {
      debugReplyNotifications: config.features.debugReplyNotifications,
      // non JSON-stringifiable fields are prefixed with an underscore
      _plugin: require(creds.plugin),
      _store: store,
      _log: makeLogger(creds.plugin)
    })))
  })
  return core
}
