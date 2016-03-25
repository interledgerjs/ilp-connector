'use strict'

const _ = require('lodash')
const http = require('http')
const superagent = require('co-supertest')
const log = require('../../src/common').log

const loadConfig = require('../../src/lib/config')
const backend = require('../../src/services/backend')
const Multiledger = require('../../src/lib/ledgers/multiledger')

const createApp = require('five-bells-connector').createApp

exports.create = function (context) {
  const config = loadConfig()
  const ledgers = new Multiledger({
    config: config,
    log: log
  })
  const app = createApp(config, ledgers)
  context.app = app
  context.backend = backend
  context.ledgers = ledgers
  context.config = config

  context.server = http.createServer(app.callback()).listen()
  context.port = context.server.address().port
  context.request = function () {
    return superagent(context.server)
  }
  context.formatId = function (sourceObj, baseUri) {
    let obj = _.cloneDeep(sourceObj)
    obj.id = 'http://localhost' + baseUri + sourceObj.id
    return obj
  }
}
