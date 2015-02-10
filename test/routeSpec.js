/*global describe, it*/
'use strict';
var superagent = require('supertest');
var app = require('../app');

function request() {
	return superagent(app.listen());
}

describe('Routes', function () {
  describe('GET /', function () {
    it('should return 200', function (done) {
      request()
        .get('/')
        .expect(200, done);
    });
  });
  describe('GET /messages', function () {
    it('should return 200', function (done) {
      request()
        .get('/messages')
        .expect('Content-Type', /json/)
        .expect(200, done);
    });
  });
  describe('GET /messages/notfound', function () {
    it('should return 404', function (done) {
      request()
        .get('/messages/notfound')
        .expect(404, done);
    });
  });
});