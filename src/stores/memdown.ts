import memdown from 'memdown'
import levelup from 'levelup'
import LeveldownStore = require('./leveldown')
import { create as createLogger } from '../common/log'
const log = createLogger('memdown-store')

class MemdownStore extends LeveldownStore {
  constructor ({ path }: { path?: string }) {
    log.info('initialize in-memory database.')
    log.warn('(!!!) balances and other important state will NOT persist across sessions. DO NOT DO THIS IN PRODUCTION!')
    const db = levelup(memdown(path || 'connector-main'))

    super({ db })
  }
}

export = MemdownStore
