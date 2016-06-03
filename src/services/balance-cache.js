'use strict'
const BalanceCache = require('../lib/balance-cache')
const ledgers = require('./ledgers')
module.exports = new BalanceCache(ledgers)
