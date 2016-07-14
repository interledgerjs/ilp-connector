'use strict'

const _ = require('lodash')
const newSqliteStore = require('../lib/sqliteStore.js')
const ilpCore = require('ilp-core')

module.exports = function (options) {
  const config = options.config
  const makeLogger = options.log

  const core = new ilpCore.Core()
  Object.keys(options.config.ledgerCredentials).forEach((ledgerId) => {
    const creds = _.clone(options.config.ledgerCredentials[ledgerId])
    const store = creds.store && newSqliteStore(creds.store)

    core.addClient(new ilpCore.Client({
      type: creds.type,
      id: ledgerId,
      auth: creds,
      store: store,
      log: makeLogger('plugin-' + creds.type),
      connector: config.server.base_uri,
      debugReplyNotifications: config.features.debugReplyNotifications
    }))
  })
  return core
}
