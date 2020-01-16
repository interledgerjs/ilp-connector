import { create as createLogger } from '../common/log'
const log = createLogger('memdown-store')

class MemoryStore {
  db: Map<string, string> = new Map()

  constructor () {
    log.info('initialize in-memory database.')
    log.warn('(!!!) balances and other important state will NOT persist across sessions. DO NOT DO THIS IN PRODUCTION!')
  }

  async get (key: string): Promise<string | undefined> {
    return this.db.get(key)
  }

  async put (key: string, value: string) {
    return this.db.set(key, value)
  }

  async del (key: string) {
    return this.db.delete(key)
  }
}

export = MemoryStore
