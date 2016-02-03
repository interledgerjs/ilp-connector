'use strict'

const ConnectorConfig = require('../lib/config')

const config = module.exports = new ConnectorConfig()
config.parseServerConfig()
config.parseConnectorConfig()
