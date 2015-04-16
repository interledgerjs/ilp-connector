'use strict';

const _ = require('lodash');
const http = require('http');
const superagent = require('co-supertest');

exports.create = function (context, app) {
  context.server = http.createServer(app.callback()).listen();
  context.port = context.server.address().port;
  context.request = function () {
    return superagent(context.server);
  };
  context.formatId = function (sourceObj, baseUri) {
    let obj = _.cloneDeep(sourceObj);
    obj.id = 'http://localhost' + baseUri + sourceObj.id;
    return obj;
  };
};
