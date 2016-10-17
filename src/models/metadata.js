'use strict'

function getMetadata (config) {
  const base = config.getIn(['server', 'base_uri'])
  return {
    urls: {
      health: base + '/health',
      pairs: base + '/pairs'
    }
  }
}

module.exports = {
  getMetadata: getMetadata
}
