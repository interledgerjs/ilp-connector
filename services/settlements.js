'use strict'

const Settlements = require('../lib/settlements')

module.exports = new Settlements({
  backend: require('./backend'),
  config: require('./config'),
  sourceSubscriptions: require('./sourceSubscriptions'),
  destinationSubscriptions: require('./destinationSubscriptions')
})
