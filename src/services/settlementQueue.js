'use strict'

const SettlementQueue = require('../lib/settlementQueue')
module.exports = new SettlementQueue(require('./config').toJS())
