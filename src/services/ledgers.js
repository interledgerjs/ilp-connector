'use strict'
const config = require('./config')
const log = require('../common').log
const Multiledger = require('../lib/ledgers/multiledger')

module.exports = new Multiledger({
  config: config,
  log: log
})
