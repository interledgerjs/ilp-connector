'use strict'

function getMetadata (config) {
  return {
    public_key: config.getIn(['keys', 'ed25519', 'public']),
    urls: {
      health: '/health',
      pairs: '/pairs',
      payment: '/payments/:uuid',
      quote: '/quote',
      notifications: '/notifications'
    }
  }
}

module.exports = {
  getMetadata: getMetadata
}
