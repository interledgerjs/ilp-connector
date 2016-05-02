'use strict'

function getMetadata (config) {
  const base = config.getIn(['server', 'base_uri'])
  return {
    urls: {
      health: base + '/health',
      pairs: base + '/pairs',
      payment: base + '/payments/:uuid',
      quote: base + '/quote',
      notifications: base + '/notifications'
    }
  }
}

module.exports = {
  getMetadata: getMetadata
}
