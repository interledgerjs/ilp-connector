'use strict'

const Subscriber = require('../lib/subscriber').Subscriber
const payments = require('./payments')
const config = require('./config')

module.exports = new Subscriber(config, payments)
