'use strict'

const riverpig = require('riverpig')

const logStream = require('through2')()
logStream.pipe(process.stdout)

const createRaw = (namespace) => {
  return riverpig(namespace, {
    stream: logStream
  })
}

const create = (namespace) => createRaw('connector:' + namespace)

let outputStream = process.stdout
const setOutputStream = (newOutputStream) => {
  logStream.unpipe(outputStream)
  logStream.pipe(newOutputStream)
  outputStream = newOutputStream
}

module.exports = {
  create,
  createRaw,
  setOutputStream
}
