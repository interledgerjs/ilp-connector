'use strict'

function createBackend (config) {
  const Backend = require('../backends/' + config.get('backend'))

  if (!Backend) {
    throw new Error('Backend not found. The backend ' +
      'module specified by CONNECTOR_BACKEND was not found in /backends')
  }

  return new Backend({
    spread: config.get('fxSpread')
  })
}

module.exports = createBackend
