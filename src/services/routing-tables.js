'use strict'

const RoutingTables = require('five-bells-routing').RoutingTables
const ROUTE_EXPIRY = 45 * 1000 // milliseconds
const config = require('./config')

module.exports = new RoutingTables(config.server.base_uri, [], ROUTE_EXPIRY)
