'use strict'

const model = require('../models/metadata')

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
exports.getResource = function * () { this.body = model.getMetadata() }
