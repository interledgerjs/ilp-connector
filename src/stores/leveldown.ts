import { resolve } from 'path'
import levelup, { LevelUp } from 'levelup'
import leveldown from 'leveldown'
import { StoreInstance } from '../types/store'
import { create as createLogger } from '../common/log'
const log = createLogger('leveldown-store')

class LeveldownStore implements StoreInstance {
  db: LevelUp

  constructor ({ db, path }: {db?: LevelUp, path?: string}) {
    if (db) {
      this.db = db
      return
    }

    if (!path) {
      log.warn('no CONNECTOR_STORE_PATH set, defaulting to ./data.')
      path = resolve(process.cwd(), 'data')
    }

    log.info('initialize database. path=%s', path)
    this.db = levelup(leveldown(path))
  }

  async get (key: string): Promise<string | undefined> {
    try {
      const value = await this.db.get(key) as Buffer | string
      if (value instanceof Buffer) {
        return value.toString('utf8')
      } else {
        return value
      }
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
