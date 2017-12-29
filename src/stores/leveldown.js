'use strict'

const path = require('path')
const levelup = require('levelup')
const leveldown = require('leveldown')
const log = require('../common/log').create('plugin-store')

class LeveldownStore {
  constructor ({ path: dbPath }) {
    if (!dbPath) {
      log.warn('no CONNECTOR_STORE_PATH set, defaulting to $CWD/data.')
      dbPath = path.resolve(process.cwd(), 'data')
    }

    log.info('initialize database. path=%s', dbPath)
    this.db = levelup(leveldown(dbPath))
  }

  async get (key) {
    try {
      return (await this.db.get(key)).toString('utf8')
    } catch (e) {
      if (e.name !== 'NotFoundError') {
        throw e
      }
    }
  }

  async put (key, value) {
    return this.db.put(key, value)
  }

  async del (key) {
    return this.db.del(key)
  }
}

module.exports = LeveldownStore
