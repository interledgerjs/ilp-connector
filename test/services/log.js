'use strict'

const hub = require('mag-hub')
const mag = require('mag')
const log = require('@ripple/five-bells-shared/lib/log')

module.exports = log(mag, hub)
