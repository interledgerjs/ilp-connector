'use strict'

import riverpig = require('riverpig')
import { Logger } from 'riverpig'

import through2 = require('through2')
const logStream = through2()
logStream.pipe(process.stdout)

// TODO: Not clear why I needed this, but got a
//   TypeScript error without it.
export interface ConnectorLogger extends Logger { }

export const createRaw = (namespace: string): ConnectorLogger => {
  return riverpig(namespace, {
    stream: logStream
  })
}

export const create = (namespace: string) => createRaw('connector:' + namespace)

let outputStream = process.stdout
export const setOutputStream = (newOutputStream: NodeJS.WriteStream) => {
  logStream.unpipe(outputStream)
  logStream.pipe(newOutputStream)
  outputStream = newOutputStream
}
