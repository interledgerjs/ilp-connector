'use strict'
const config = require('../services/config')

const metadata = {
  public_key: config.getIn(['keys', 'ed25519', 'public']),
  urls: {
    health: '/health',
    pairs: '/pairs',
    payment: '/payments/:uuid',
    quote: '/quote',
    notifications: '/notifications'
  }
}

/**
 * @api {get} / Get the server metadata
 * @apiName GetMetadata
 * @apiGroup Metadata
 * @apiVersion 1.0.0
 *
 * @apiDescription This endpoint will return server metadata.
 *
 * @returns {void}
 */
exports.getResource = function * () { this.body = metadata }
