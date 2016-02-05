'use strict'

const config = require('./config')

try {
  const Backend = require('../backends/' + config.get('backend'))
  // TODO: should we pass in configuration here?
  module.exports = new Backend()
} catch (e) {
  throw new Error('Backend not found. The backend ' +
    `module specified by CONNECTOR_BACKEND, ${config.get('backend')}, was not found in /backends`)
}

