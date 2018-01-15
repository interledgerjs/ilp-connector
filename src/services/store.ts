import Config from './config'
import reduct = require('reduct')
import { StoreConstructor, StoreInstance } from '../types/store'

import { loadModuleOfType } from '../lib/utils'

export default class Store {
  protected config: Config
  protected store: StoreInstance

  constructor (deps: reduct.Injector) {
    this.config = deps(Config)

    const Store: StoreConstructor = loadModuleOfType('store', this.config.store)
    this.store = new Store(Object.assign({
      path: this.config.storePath
    }, this.config.storeConfig), {})
  }

  getPluginStore (name: string) {
    if (!name.match(/^[A-Za-z0-9_\-~.]+$/)) {
      throw new Error('"' + name + '" includes forbidden characters.')
    }

    return {
      get: (key: string) => {
        return this.store.get(name + key)
      },

      put: (key: string, value: string) => {
        return this.store.put(name + key, value)
      },

      del: (key: string) => {
        return this.store.del(name + key)
      }
    }
  }

  async get (key: string) {
    return this.store.get(key)
  }

  async put (key: string, value: string) {
    return this.store.put(key, value)
  }

  async del (key: string) {
    return this.store.del(key)
  }
}
