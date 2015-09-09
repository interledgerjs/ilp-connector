module.exports = function (wallaby) {
  return {
    files: [
      'controllers/*.js',
      'lib/*.js',
      'services/*.js',
      'utils/*.js',
      'errors/*.js',
      'test/data/*.json',
      'test/helpers/*.js',
      'app.js'
    ],

    tests: [
      'test/*Spec.js'
    ],

    testFramework: 'mocha',

    env: {
      type: 'node',
      params: {
        env: 'NODE_ENV=unit'
      }
    },

    debug: true,
    bootstrap: function () {
      var path = require('path')
      require('co-mocha')(require(path.join(path.dirname(process.argv[1]), 'runners/node/mocha@2.1.0/framework/')))
    }
  }
}
