'use strict'

const ExternalError = require('../errors/external-error')
const log = require('../common').log('precision-cache')
const request = require('co-request')
let _cache = {}

function * getPrecisionAndScale (ledger) {
  log.debug('getPrecisionAndScale', ledger)
  function throwErr () {
    throw new ExternalError('Unable to determine ledger precision')
  }

  let res
  try {
    res = yield request(ledger, {json: true})
  } catch (e) {
    if (!res || res.statusCode !== 200) {
      log.debug('getPrecisionAndScale', e)
      throwErr()
    }
  }

  if (!res || res.statusCode !== 200) throwErr()
  if (!res.body.precision || !res.body.scale) throwErr()

  log.debug('getPrecisionAndScale', res.body)
  return {
    precision: res.body.precision,
    scale: res.body.scale
  }
}

function * get (ledger) {
  const cached = _cache[ledger]
  if (cached) {
    return cached
  }

  const precision = yield getPrecisionAndScale(ledger)
  _cache[ledger] = precision
  return _cache[ledger]
}

function reset () {
  _cache = {}
}

module.exports = {
  get: get,
  reset: reset
}

