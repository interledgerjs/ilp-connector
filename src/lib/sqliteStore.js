'use strict'

const sqlite3 = require('sqlite3').verbose()

function newSqliteStore (address) {
  address = address || ':memory:'

  const db = new sqlite3.Database(address)
  db.run('CREATE TABLE IF NOT EXISTS store (key TEXT, value TEXT)', () => {
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS id ON store (key)')
  })

  const put = function (k, v) {
    return new Promise((resolve) => {
      db.run('REPLACE INTO store (key, value) VALUES (?, ?)', k, v, () => {
        resolve()
      })
    })
  }

  const get = function (k) {
    return new Promise((resolve) => {
      let items = []
      db.each('SELECT key, value FROM store WHERE (key == ?)', k, (key, v) => {
        items.push(v.value)
      }, () => {
        resolve(items[0] || undefined)
      })
    })
  }

  const del = function (k) {
    return new Promise((resolve) => {
      db.run('DELETE FROM store WHERE (key == ?)', k, () => {
        resolve()
      })
    })
  }

  return { get: get, put: put, del: del }
}

module.exports = newSqliteStore
