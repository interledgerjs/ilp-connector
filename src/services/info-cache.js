'use strict'

const InfoCache = require('../lib/info-cache')

module.exports = new InfoCache(
  require('./ledgers')
)
