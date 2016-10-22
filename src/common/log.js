'use strict'

const riverpig = require('riverpig')

const Config = require('five-bells-shared').Config
const envPrefix = 'CONNECTOR'
const logLevel = Config.getEnv(envPrefix, 'LOG_LEVEL')

const defaultLogger = riverpig('connector')

defaultLogger.create = riverpig

module.exports = defaultLogger
