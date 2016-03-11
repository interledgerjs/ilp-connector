'use strict'

const config = require('../services/config')

function getMetadata () {
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
