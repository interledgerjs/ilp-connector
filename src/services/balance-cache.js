'use strict'
const config = require('../services/config')
const BalanceCache = require('../lib/balance-cache')
module.exports = new BalanceCache(config)
