'use strict'

const hub = require('mag-hub')
const mag = require('mag')
const log = require('five-bells-shared/lib/log')
const debug = require('debug')

debug.formatArgs = null
debug.log = function () {
  hub.write({
    arguments: Array.prototype.slice.call(arguments),
    severity: 6,
    timestamp: new Date(),
    namespace: this.namespace
  })
}

module.exports = log(mag, hub)
