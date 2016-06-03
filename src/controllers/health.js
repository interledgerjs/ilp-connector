'use strict'

const _ = require('lodash')
const healthStatus = require('../common/health.js')

/**
 * @api {get} /health Get server health status
 * @apiName GetHealth
 * @apiGroup Health
 * @apiVersion 1.0.0
 *
 * @apiDescription This endpoint will perform a quick self-check to ensure the
 *   server is still operating correctly.
 *
 * @apiIgnore For internal use.
 *
 * @returns {void}
 */
exports.getResource = function * health () {
  const backendStatus = yield this.backend.getStatus()
  const ledgersStatus = this.ledgers.getStatus()
  const body = _.extend({}, backendStatus, ledgersStatus)
  body.status = (backendStatus.backendStatus === healthStatus.statusOk &&
                 ledgersStatus.ledgersStatus === healthStatus.statusOk) ? healthStatus.statusOk
                                                                        : healthStatus.statusNotOk
  // TODO: add more status, ledger connection, quoter connection,...
  this.body = body
}
