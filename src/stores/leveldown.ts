'use strict'

import { resolve } from 'path'
import levelup, { LevelUp } from 'levelup'
import leveldown from 'leveldown'
import { IStore } from '../types/store'
import { create as createLogger } from '../common/log'
const log = createLogger('leveldown')

class LeveldownStore implements IStore {
  db: LevelUp

  constructor ({ db, path: dbPath }: {db?: LevelUp, path?: string}) {
    if (db) {
      this.db = db
      return
    }

    if (!dbPath) {
      log.warn('no CONNECTOR_STORE_PATH set, defaulting to ./data.')
      dbPath = resolve(process.cwd(), 'data')
    }

    log.info('initialize database. path=%s', dbPath)
    this.db = levelup(leveldown(dbPath))
  }

  async get (key: string) {
    try {
      return (await this.db.get(key)).toString('utf8')
    } catch (e) {
      if (e.name !== 'NotFoundError') {
        throw e
      }
    }
  }

  async put (key: string, value: string) {
    return this.db.put(key, value)
  }

  async del (key: string) {
    return this.db.del(key)
  }
}

export = LeveldownStore
