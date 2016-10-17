'use strict'

const nock = require('nock')
const expect = require('chai').expect
nock.enableNetConnect(['localhost', '127.0.0.1'])
const appHelper = require('./helpers/app')
const logger = require('../src/common').log
const logHelper = require('./helpers/log')

describe('Metadata', function () {
  logHelper(logger)

  beforeEach(function () {
    appHelper.create(this)
  })

  describe('GET /', function () {
    it('should return metadata', function * () {
      yield this.request()
        .get('/')
        .expect(200)
        .expect(function (res) {
          expect(res.body).to.deep.equal({
            urls: {
              health: 'http://localhost/health',
              pairs: 'http://localhost/pairs'
            }
          })
        })
        .end()
    })
  })
})
