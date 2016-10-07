'use strict'

const config = require('./config')
const TradingPairs = require('../lib/trading-pairs')
module.exports = new TradingPairs(config.get('tradingPairs'))
