'use strict'
const BalanceCache = require('../lib/balance-cache')
const core = require('./core')
module.exports = new BalanceCache(core)
