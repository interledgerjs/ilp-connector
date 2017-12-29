'use strict'

const path = require('path')
const Config = require('./config')

const { loadModuleFromPathOrDirectly } = require('../lib/utils')

class Store {
  constructor (deps) {
    this.config = deps(Config)

    this.Store = getStore(this.config.store)
    this.store = new this.Store({
      path: this.config.storePath
    }, this.config.storeConfig)
  }

  getPluginStore (name) {
    if (!name.match(/^[A-Za-z0-9_\-~.]+$/)) {
      throw new Error('"' + name + '" includes forbidden characters.')
    }

    return {
      get (key) {
        return this.store.get(name + key)
      },

      put (key, value) {
        return this.store.put(name + key, value)
      },

      del (key) {
        return this.store.del(name + key)
      }
    }
  }

  async get (key) {
    return this.store.get(key)
  }

  async put (key, value) {
    return this.store.put(key, value)
  }

  async del (key) {
    return this.store.del(key)
  }
}

function getStore (store) {
  const module = loadModuleFromPathOrDirectly(path.resolve(__dirname, '../stores/'), store)

  if (!module) {
    throw new Error('Store not found at "' + store + '" or "/stores/' + store + '"')
  }

  return require(module)
}

module.exports = Store
