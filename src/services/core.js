'use strict'

const makeCore = require('../lib/core')
const config = require('./config')
const log = require('../common').log
const routingTables = require('./routing-tables')
module.exports = makeCore({config, log, routingTables})
