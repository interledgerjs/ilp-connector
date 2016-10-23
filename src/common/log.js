'use strict'

const riverpig = require('riverpig')

const logStream = require('through2')()
logStream.pipe(process.stdout)

const create = (namespace) => {
  return riverpig(namespace, {
    stream: logStream
  })
}

let outputStream = process.stdout
const setOutputStream = (newOutputStream) => {
  logStream.unpipe(outputStream)
  logStream.pipe(newOutputStream)
  outputStream = newOutputStream
}

module.exports = {
  create,
  setOutputStream
}
