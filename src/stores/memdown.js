'use strict'

const memdown = require('memdown')
const levelup = require('levelup')
const LeveldownStore = require('./leveldown')
const log = require('../common/log').create('memdown')

class MemdownStore extends LeveldownStore {
  constructor () {
    log.info('initialize in-memory database.')
    log.warn('(!!!) balances and other important state will NOT persist across sessions. DO NOT DO THIS IN PRODUCTION!')
    const db = levelup(memdown())

    super({ db })
  }
}

module.exports = MemdownStore
