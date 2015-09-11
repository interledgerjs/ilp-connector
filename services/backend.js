'use strict'

const config = require('./config')
const Backend = require('../backends/' + config.backend)

if (!Backend) {
  throw new Error('Backend not found. The backend ' +
    'module specified by TRADER_BACKEND was not found in /backends')
}

// TODO: should we pass in configuration here?
module.exports = new Backend()
