'use strict'

// This helper captures log output for each test and prints it in case of
// failure. This means that a successful test run will only print mocha's output
// whereas a failed run will include more information.

const through = require('through2')

module.exports = function (logger) {
  let buffer
  beforeEach(function () {
    buffer = through()
    buffer.pause()
    logger.setOutputStream(buffer)
  })

  afterEach(function () {
    if (this.currentTest.state !== 'passed') {
      buffer.pipe(process.stdout, { end: false })
      buffer.end()
    }
    logger.setOutputStream(process.stdout)
  })
}
