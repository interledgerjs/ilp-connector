'use strict'

const nock = require('nock')
const expect = require('chai').expect
nock.enableNetConnect(['localhost', '127.0.0.1'])
const app = require('five-bells-connector').app
const appHelper = require('./helpers/app')
const logger = require('../src/services/log')
const logHelper = require('five-bells-shared/testHelpers/log')

beforeEach(function () {
  appHelper.create(this, app)
})

describe('Metadata', function () {
  logHelper(logger)

  describe('GET /', function () {
    it('should return metadata', function *() {
      yield this.request()
        .get('/')
        .expect(200)
        .expect(function (res) {
          expect(res.body.public_key).to.be.a('string')
          expect(res.body).to.deep.equal({
            public_key: res.body.public_key,
            urls: {
              health: '/health',
              pairs: '/pairs',
              payment: '/payments/:uuid',
              quote: '/quote',
              notifications: '/notifications'
            }
          })
        })
        .end()
    })
  })
})
