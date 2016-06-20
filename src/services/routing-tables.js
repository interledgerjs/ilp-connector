'use strict'

const RoutingTables = require('five-bells-routing').RoutingTables
const config = require('./config')

module.exports = new RoutingTables(config.server.base_uri, [], config.routeExpiry)
