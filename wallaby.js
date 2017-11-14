'use strict'

module.exports = function (wallaby) {
  const path = require('path')
  process.env.NODE_PATH += path.delimiter + path.join(wallaby.localProjectDir, '..')

  return {
    files: [
      'src/**/*.js',
      'schemas/*.json',
      'test/node_modules',
      'test/data/*',
      'test/helpers/*.js',
      'test/mocks/*.js',
      'test/node_modules/*',
      'app.js'
    ],

    tests: [
      'test/*Spec.js'
    ],

    testFramework: 'mocha',

    env: {
      type: 'node',
      runner: 'node',
      params: {
        env: 'NODE_ENV=unit'
      }
    }
  }
}
