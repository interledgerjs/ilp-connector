'use strict'
const config = require('./config')
const log = require('./log')
const sourceSubscriptions = require('./sourceSubscriptions')
const Multiledger = require('../lib/ledgers/multiledger')

module.exports = new Multiledger({
  config: config,
  log: log,
  sourceSubscriptions: sourceSubscriptions
})
