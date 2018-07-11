import * as riverpig from 'riverpig'
import { LoggerConfig } from 'riverpig'
import { Logger } from 'riverpig'
import * as debug from 'debug'

import through2 = require('through2')
const logStream = through2()
logStream.pipe(process.stdout)

export class ConnectorLogger {
  river: any
  tracer: any

  constructor (namespace: string, config0?: LoggerConfig) {
    this.river = riverpig(namespace, config0) 
    this.tracer = this.river.trace || debug(namespace + ':trace')
  }

  info (msg: any, ...elements: any[]): void {
    this.river.info(msg, ...elements)
  }

  warn (msg: any, ...elements: any[]): void {
    this.river.warn(msg, ...elements)
  }

  error (msg: any, ...elements: any[]): void {
    this.river.error(msg, ...elements)
  }

  debug (msg: any, ...elements: any[]): void {
    this.river.debug(msg, ...elements)
  }

  trace (msg: any, ...elements: any[]): void {
    this.tracer(msg, ...elements)
  }
}

export const createRaw = (namespace: string): ConnectorLogger => {
  return new ConnectorLogger(namespace, {
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
