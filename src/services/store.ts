'use strict'

import { resolve } from 'path'
import Config from './config'
import reduct = require('reduct')
import { IStore } from '../types/store'

import { loadModuleFromPathOrDirectly } from '../lib/utils'

export default class Store {
  protected config: Config
  protected store: IStore

  constructor (deps: reduct.Injector) {
    this.config = deps(Config)

    const Store = getStore(this.config.store)
    this.store = new Store({
      path: this.config.storePath
    }, this.config.storeConfig)
  }

  getPluginStore (name: string) {
    if (!name.match(/^[A-Za-z0-9_\-~.]+$/)) {
      throw new Error('"' + name + '" includes forbidden characters.')
    }

    return {
      get (key: string) {
        return this.store.get(name + key)
      },

      put (key: string, value: string) {
        return this.store.put(name + key, value)
      },

      del (key: string) {
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

function getStore (store: string) {
  const module = loadModuleFromPathOrDirectly(resolve(__dirname, '../stores/'), store)

  if (!module) {
    throw new Error('Store not found at "' + store + '" or "/stores/' + store + '"')
  }

  return require(module)
}
