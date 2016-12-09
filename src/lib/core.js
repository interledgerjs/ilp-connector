'use strict'

const _ = require('lodash')
const PluginStore = require('../lib/pluginStore.js')
const ilpCore = require('ilp-core')

module.exports = function (options) {
  const config = options.config
  const makeLogger = options.log.create
  const routingTables = options.routingTables

  const core = new ilpCore.Core({routingTables})
  Object.keys(config.ledgerCredentials).forEach((ledgerPrefix) => {
    const creds = _.cloneDeep(config.ledgerCredentials[ledgerPrefix])
    let store = null

    if (creds.store) {
      if (!config.databaseUri) {
        throw new Error('missing DB_URI; cannot create plugin store for ' + ledgerPrefix)
      }
      store = new PluginStore(config.databaseUri, ledgerPrefix)
    }

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
