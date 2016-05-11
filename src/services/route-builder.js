'use strict'

const RouteBuilder = require('../lib/route-builder')
const precisionCache = require('../services/precision-cache.js')
const config = require('./config')
module.exports = new RouteBuilder(
  require('./routing-tables'),
  precisionCache, {
    minMessageWindow: config.expiry.minMessageWindow,
    slippage: config.slippage,
    ledgerCredentials: config.ledgerCredentials
  })
