'use strict'

const Payments = require('../lib/payments')

module.exports = new Payments({
  backend: require('./backend'),
  config: require('./config'),
  settlementQueue: require('../../services/settlementQueue'),
  destinationSubscriptions: require('./destinationSubscriptions')
})
