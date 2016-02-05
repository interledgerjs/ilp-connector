'use strict'

const config = require('./config')
const Backend = require('../backends/' + config.get('backend'))

if (!Backend) {
  throw new Error('Backend not found. The backend ' +
    'module specified by CONNECTOR_BACKEND was not found in /backends')
}

module.exports = new Backend({
  spread: config.get('fxSpread')
})
