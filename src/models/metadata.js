'use strict'

function getMetadata (config) {
  return {
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
