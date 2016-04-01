'use strict'

function getMetadata (config) {
  return {
    urls: {
      health: '/health',
      pairs: '/pairs',
      payment: '/payments/:uuid',
      quote: '/quote',
      quote_local: '/quote_local',
      notifications: '/notifications'
    }
  }
}

module.exports = {
  getMetadata: getMetadata
}
