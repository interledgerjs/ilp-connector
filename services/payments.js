'use strict'

const Payments = require('../lib/payments')

module.exports = new Payments({
  backend: require('./backend'),
  config: require('./config'),
  sourceSubscriptions: require('./sourceSubscriptions'),
  destinationSubscriptions: require('./destinationSubscriptions')
})
