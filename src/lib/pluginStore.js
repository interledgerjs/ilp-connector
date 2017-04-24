'use strict'

const Sequelize = require('sequelize')
const Database = require('five-bells-shared').DB(Sequelize)

class PluginStore {
  constructor (uri, name) {
    this.name = name
    this.db = new Database(uri)

    if (!name.match(/^[A-Za-z0-9_\-~.]+$/)) {
      throw new Error('"' + name + '" includes forbidden characters.')
    }

    this.Store = this.db.define('plugin_store_' + name, {
      key: { type: Sequelize.TEXT, primaryKey: true },
      value: Sequelize.TEXT
    })

    this.connected = false
  }

  connect () {
    if (this.connected) {
      return Promise.resolve(null)
    }

    this.connected = true
    return this.db.authenticate()
      .then(() => {
        return this.db.sync()
      })
  }

  get (key) {
    return this.connect().then(() => {
      return this.Store.findOne({
        where: { key: key }
      })
    }).then((res) => {
      return res && res.dataValues.value || undefined
    })
  }

  put (key, value) {
    return this.connect().then(() => {
      return this.Store.upsert({
        key: key,
        value: value
      })
    }).then(() => {
      return null
    })
  }

  del (key) {
    return this.connect().then(() => {
      return this.Store.destroy({
        where: { key: key }
      })
    }).then(() => {
      return null
    })
  }
}

module.exports = PluginStore
