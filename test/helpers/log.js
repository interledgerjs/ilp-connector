'use strict'

/* global beforeEach, afterEach */

// This helper captures log output for each test and prints it in case of
// failure. This means that a successful test run will only print mocha's output
// whereas a failed run will include more information.

const through = require('through2')
const format = require('bunyan-format')({outputMode: 'short'})

module.exports = function (logger) {
  beforeEach(function () {
    const buffer = through()
    buffer.pause()
    logger.setOutputStream(buffer)
  })

  afterEach(function () {
    const buffer = logger.currentOutput
    if (this.currentTest.state !== 'passed') {
      buffer.pipe(format)
    }
    logger.setOutputStream(format)
  })
}
