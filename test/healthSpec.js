'use strict'

const nock = require('nock')
nock.enableNetConnect(['localhost', '127.0.0.1'])
const app = require('five-bells-connector').app
const appHelper = require('./helpers/app')
const logger = require('../src/services/log')
const logHelper = require('five-bells-shared/testHelpers/log')

beforeEach(function () {
  appHelper.create(this, app)
})

describe('Health', function () {
  logHelper(logger)

  describe('GET /health', function () {
    it('should return 200', function *() {
      yield this.request()
        .get('/health')
        .expect(200)
        .end()
    })
  })
})
